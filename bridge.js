const http = require("http");
const https = require("https");
const zlib = require("zlib");
// const { createCanvas, loadImage } = require("canvas")
const isValidUTF8 = require('utf-8-validate');
const stringify = require('string.ify');
const { segment } = require('oicq');
const stringify_config = stringify.configure({
    pure: false,
    json: false,
    maxDepth: 2,
    maxLength: 10,
    maxArrayLength: 20,
    maxObjectLength: 20,
    maxStringLength: 30,
    precision: undefined,
    formatter: undefined,
    pretty: true,
    rightAlignKeys: true,
    fancy: false,
    indentation: '  ',
})
const sandbox = require("./sandbox");

process.on("disconnect", process.exit)
process.on("message", (value) => {
    if (!value.echo) {
        onmessage(value)
    } else {
        handler.get(value.echo)?.(value)
        handler.delete(value.echo)
    }
})
const handler = new Map
function callApi(method, params = [], check = true) {
    if (check)
        precheck(() => { })
    const echo = String(Math.random()) + String(Date.now())
    process.send({
        uin: getSid(),
        method, params, echo
    })
    return new Promise((resolve) => handler.set(echo, resolve))
}

const bots = new Map
async function init(data, gid) {
    if (!bots.has(data.self_id))
        bots.set(data.self_id, {})
    const bot = bots.get(data.self_id)
    if (!bot.groups) {
        sandbox.setEnv(data)
        bot.groups = (await callApi("getGroupList", [], false)).data
        bot.groups = new Map(bot.groups)
    }
    if (!gid) {
        for (const [gid, ginfo] of bot.groups) {
            sandbox.setEnv(data)
            let members = (await callApi("getGroupMemberList", [gid], false)).data
            if (!members) continue
            members = new Map(members)
            ginfo.members = {}
            for (const [uid, minfo] of members) {
                ginfo.members[uid] = minfo
                Object.freeze(minfo)
            }
            Object.freeze(ginfo.members)
            Object.freeze(ginfo)
        }
    } else {
        sandbox.setEnv(data)
        const ginfo = (await callApi("getGroupInfo", [gid], false)).data
        sandbox.setEnv(data)
        let members = (await callApi("getGroupMemberList", [gid], false)).data
        if (!ginfo || !members) return
        members = new Map(members)
        ginfo.members = {}
        for (const [uid, minfo] of members) {
            ginfo.members[uid] = minfo
            Object.freeze(minfo)
        }
        Object.freeze(ginfo.members)
        Object.freeze(ginfo)
        bot.groups.set(gid, ginfo)
    }
}

const getGid = () => sandbox.getContext().data.group_id
const getSid = () => sandbox.getContext().data.self_id

const async_queue = {}
const checkAndAddAsyncQueue = (o) => {
    const key = getSid() + getGid() + sandbox.getContext().data.user_id
    if (!async_queue.hasOwnProperty([key])) {
        async_queue[key] = new Map()
        async_queue[key].set("start_moment", 0)
    }
    let endless_flag = false
    let start_moment = async_queue[key].get("start_moment")
    async_queue[key].forEach((v, k, map) => {
        if (k === "start_moment")
            return
        if (v.end_time && Date.now() - v.end_time > 500)
            map.delete(k)
        else {
            endless_flag = true
            if (start_moment === 0)
                async_queue[key].set("start_moment", Date.now())
        }
    })
    if (!endless_flag)
        async_queue[key].set("start_moment", 0)
    if (async_queue[key].get("start_moment") > 0 && Date.now() - async_queue[key].get("start_moment") > 60000) {
        async_queue[key].set("start_moment", 0)
        throw new Error("?????????????????????????????????")
    }
    async_queue[key].set(o, { start_time: Date.now(), end_time: undefined })
}

const asyncCallback = (o, env, callback, argv = []) => {
    const key = env.self_id + env.group_id + env.user_id
    async_queue[key].get(o).end_time = Date.now()
    sandbox.setEnv(env)
    const function_name = "tmp_" + Date.now()
    const argv_name = "tmp_argv_" + Date.now()
    sandbox.getContext()[function_name] = callback
    sandbox.getContext()[argv_name] = argv
    try {
        sandbox.exec(`this.${function_name}.apply(null, this.${argv_name})`)
    } catch (e) { }
    sandbox.exec(`delete this.${function_name};delete this.${argv_name}`)
}

const buckets = {}
const checkFrequency = () => {
    let uid = sandbox.getContext().data.user_id
    if (!uid)
        return
    if (buckets.hasOwnProperty(uid) && Date.now() - buckets[uid].time > 300)
        delete buckets[uid]
    if (!buckets.hasOwnProperty(uid))
        buckets[uid] = { time: 0, cnt: 0 }
    if (buckets[uid].cnt >= 3)
        throw new Error("?????????????????????")
    buckets[uid].time = Date.now()
    ++buckets[uid].cnt
}

const precheck = function (caller) {
    checkFrequency()
    let function_name = "current_called_api_" + Date.now()
    sandbox.getContext()[function_name] = caller
    sandbox.exec(`if (typeof this.beforeApiCalled === "function") {
    this.beforeApiCalled(this.${function_name})
    delete this.${function_name}
}`)
}

sandbox.include("setTimeout", function (fn, timeout = 5000, argv = []) {
    checkFrequency()
    checkAndAddAsyncQueue(this)
    if (typeof fn !== "function")
        throw new TypeError("fn(???????????????)??????????????????")
    timeout = parseInt(timeout)
    if (isNaN(timeout) || timeout < 5000)
        throw new Error("????????????????????????5000?????????")
    const env = sandbox.getContext().data
    const cb = () => asyncCallback(this, env, fn, argv)
    return setTimeout(cb, timeout)
})
sandbox.include("clearTimeout", clearTimeout)

const fetch = function (url, callback = () => { }, headers = null) {
    checkFrequency()
    checkAndAddAsyncQueue(this)
    if (typeof url !== "string")
        throw new TypeError("url(???????????????)?????????????????????")
    if (typeof callback !== "function")
        throw new TypeError("callback(???????????????)??????????????????")
    if (typeof headers !== "object")
        throw new TypeError("headers(???????????????)??????????????????")
    const env = sandbox.getContext().data
    const cb = (data) => asyncCallback(this, env, callback, [data])
    url = url.trim()
    const protocol = url.substr(0, 5) === "https" ? https : http
    let data = []
    let size = 0
    const options = {
        headers: {
            "Accept-Encoding": "gzip",
            ...headers
        }
    }
    try {
        protocol.get(url, options, (res) => {
            if (res.statusCode !== 200) {
                res.headers["status-code"] = res.statusCode
                cb(res.headers)
                return
            }
            res.on("data", chunk => {
                size += chunk.length
                if (size > 500000) {
                    res.destroy()
                    return
                }
                data.push(chunk)
            })
            res.on("end", () => {
                if (res.headers["content-encoding"] && res.headers["content-encoding"].includes("gzip")) {
                    try {
                        zlib.gunzip(Buffer.concat(data), (err, buffer) => {
                            if (err)
                                buffer = JSON.stringify(err)
                            cb(buffer.toString())
                        })
                    } catch { }
                } else {
                    const buf = Buffer.concat(data)
                    cb(isValidUTF8(buf) ? buf.toString() : buf)
                }
            })
        }).on("error", err => cb(err))
    } catch (e) {
        cb(e)
    }
}
sandbox.include("fetch", fetch)

//master????????????????????????
sandbox.include("run", (code) => {
    if (sandbox.getContext().isMaster()) {
        try {
            return eval(code)
        } catch (e) {
            return e.stack
        }
    } else
        throw new Error("403 forbidden")
})

//????????????????????????
sandbox.include("??????", require("syanten"))
sandbox.include("MJ", require("riichi"))
// sandbox.include("cheerio", require("cheerio"))
sandbox.getContext().cheerio = require("cheerio") //????????????
sandbox.include("moment", require("moment"))
sandbox.include("assert", require("assert"))
// sandbox.include("crypto", require("crypto"))
sandbox.getContext().crypto = require('crypto');
sandbox.include("querystring", require("querystring"))
sandbox.include("path", require("path"))
sandbox.include("zip", require("zlib").deflateSync)
sandbox.include("unzip", require("zlib").unzipSync)
sandbox.include("os", require("os"))
sandbox.include("Buffer", Buffer)

sandbox.include("console", {
    log(msg) {
        return msg;
    }
})
sandbox.include("at", function at(qq) {
    callApi("sendGroupMsg", [getGid(), segment.at(qq)])
})

// ?????????????????????
const ero = /(??????|??????|??????|??????|??????|??????|??????|?????????|b???|???b|??????|??????|??????|???|???|???|???|???|???|???|???|???|???|???|???|???|???|???|??????|??????|?????????|?????????|??????|??????|??????|??????|?????????|?????????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|?????????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|?????????|??????|??????|a???|??????|??????|??????|???b|??????|???b|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|???|??????|??????|??????|?????????|??????|??????|??????|??????|?????????|??????|??????|??????|??????|??????|??????|??????|???8|???ba|??????|??????|??????|??????|?????????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????|??????)/ig
function filter(msg) {
    if (typeof msg === "undefined")
        return
    else if (typeof msg !== "string")
        msg = stringify_config(msg)
    msg = msg.replace(ero, "???")
    if (!msg.length)
        return
    return msg
}

// qq api
const $ = {}
$.getGroupInfo = () => {
    return bots.get(getSid())?.groups?.get(getGid())
}
$.sendPrivateMsg = (uid, msg, escape_flag = false) => {
    msg = filter(msg)
    if (!msg) return
    callApi("sendPrivateMsg", [uid, segment.fromCqcode(msg)])
}
$.sendGroupMsg = (gid, msg, escape_flag = false) => {
    msg = filter(msg)
    if (!msg) return
    callApi("sendGroupMsg", [gid, segment.fromCqcode(msg)])
}
$.sendDiscussMsg = (id, msg, escape_flag = false) => {
    msg = filter(msg)
    if (!msg) return
    callApi("sendDiscussMsg", [id, segment.fromCqcode(msg)])
}
$.deleteMsg = (message_id) => {
    callApi("deleteMsg", [message_id])
}
$.setGroupKick = (uid, forever = false) => {
    callApi("setGroupKick", [getGid(), uid, forever])
}
$.setGroupBan = (uid, duration = 60) => {
    callApi("setGroupBan", [getGid(), uid, duration])
}
$.setGroupAnonymousBan = (flag, duration = 60) => {
    callApi("setGroupAnonymousBan", [getGid(), flag, duration])
}
$.setGroupAdmin = (uid, enable = true) => {
    callApi("setGroupAdmin", [getGid(), uid, enable])
}
$.setGroupWholeBan = (enable = true) => {
    callApi("setGroupWholeBan", [getGid(), enable])
}
$.setGroupAnonymous = (enable = true) => {
    callApi("setGroupAnonymous", [getGid(), enable])
}
$.setGroupCard = (uid, card) => {
    callApi("setGroupCard", [getGid(), uid, card])
}
$.setGroupLeave = (dismiss = false) => {
    callApi("setGroupLeave", [getGid(), dismiss])
}
$.setGroupSpecialTitle = (uid, title, duration = -1) => {
    callApi("setGroupSpecialTitle", [getGid(), uid, title, duration])
}
$.sendGroupNotice = (content) => {
    callApi("sendGroupNotice", [getGid(), content])
}
$.sendGroupPoke = (uid) => {
    callApi("sendGroupPoke", [getGid(), uid])
}
$.setGroupRequest = (flag, approve = true, reason = undefined) => {
    callApi("setGroupAddRequest", [flag, approve, reason])
}
$.setFriendRequest = (flag, approve = true, remark = undefined) => {
    callApi("setFriendAddRequest", [flag, approve, remark])
}
$.setGroupInvitation = (flag, approve = true, reason = undefined) => {
    callApi("setGroupAddRequest", [flag, approve, reason])
}
$.inviteFriend = (gid, uid) => {
    callApi("inviteFriend", [gid, uid])
}
$.ajax = fetch
$.get = fetch
sandbox.include("$", $)

/**
 * @param {import("oicq").EventData} data 
 */
function onmessage(data) {
    if (data.post_type === "message") {
        if (data.message_type === "group" && bots.has(data.user_id) && data.user_id !== data.self_id && data.user_id < data.self_id) {
            return callApi("setGroupLeave", [data.group_id], false)
        }
        let message = ""
        for (let v of data.message) {
            if (v.type === "text")
                message += v.text
            else if (v.type === "at") {
                if (v.qq === data.self_id && !message)
                    continue
                message += `'[CQ:at,qq=${v.qq}]'`
            } else {
                for (let k in v) {
                    if (k === "type")
                        message += `[CQ:${v.type}`
                    else
                        message += `,${k}=${v[k]}`
                }
                message += `]`
            }
        }
        message = message.trim()
        data.message = message
        sandbox.setEnv(data)
        let res = sandbox.run(message)
        let echo = true
        if (message.match(/^'\[CQ:at,qq=\d+\]'$/))
            echo = false
        if (res === null && message === "null")
            echo = false
        if (["number", "boolean"].includes(typeof res) && res.toString() === message)
            echo = false
        if (message.substr(0, 1) === "\\" && typeof res === "undefined")
            res = "<undefined>"
        res = filter(res)
        if (echo && res) {
            res = segment.fromCqcode(res)
            if (data.message_type === "private")
                callApi("sendPrivateMsg", [data.user_id, res], false)
            else if (data.message_type === "group")
                callApi("sendGroupMsg", [data.group_id, res], false)
            else if (data.message_type === "discuss")
                callApi("sendDiscussMsg", [data.discuss_id, res], false)
        }
    } else {
        sandbox.setEnv(data)
    }
    if (!bots.has(data.self_id))
        init(data)
    else if (data.post_type === "notice" && data.notice_type === "group")
        init(data, data.group_id)
    try {
        sandbox.exec(`try{this.onEvents()}catch(e){}`)
    } catch { }
}

//??????????????????
Function.prototype.view = Function.prototype.toString
Function.prototype.constructor = new Proxy(Function, {
    apply: () => {
        throw Error("???????????????????????????????????????")
    },
    constructor: () => {
        throw Error("???????????????????????????????????????")
    }
})
Object.freeze(Object)
Object.freeze(Object.prototype)
Object.freeze(Function)
Object.freeze(Function.prototype)
