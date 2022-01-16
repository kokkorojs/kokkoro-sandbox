const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { logger, getOption } = require('kokkoro-core');

const bots = new Map

/**
 * @type {cp.ChildProcess}
 */
let worker;
let flag = true;

(function startWorker() {
    if (!flag)
        return
    logger.mark("sandbox 启动");
    worker = cp.fork(path.join(__dirname, "bridge.js"))
    worker.on("error", (err) => {
        fs.appendFile("err.log", Date() + " " + err.stack + "\n", () => { })
    })
    worker.on("exit", () => {
        logger.mark("sandbox 停止");
        startWorker()
    })
    worker.on("message", async (value) => {
        const bot = bots.get(value?.uin)
        if (!bot)
            return
        let ret = await bot[value?.method]?.apply(bot, value?.params)
        if (ret instanceof Map)
            ret = Array.from(ret)
        ret.echo = value?.echo
        worker.send({
            data: ret,
            echo: value?.echo
        })
    })
})();

function listener(event) {
    const option = getOption(event);

    if (!option.apply) {
        return;
    }
    event.self_id = this.uin;
    worker.send(event);
}

/**
 * 当一个bot实例启用了此插件时被调用
 * @param {import("oicq").Client} bot 
 */
function enable(bot) {
    bots.set(bot.uin, bot)
    bot.on("message.group", listener)
    bot.on("notice", listener)
    bot.on("request", listener)
    // bot.on("system", listener)
}

/**
 * 当一个bot实例禁用了此插件时被调用
 * @param {import("oicq").Client} bot 
 */
function disable(bot) {
    bot.off("message.group", listener)
    bot.off("notice", listener)
    bot.off("request", listener)
    // bot.off("system", listener)
    bots.delete(bot.uin)
}

function destroy() {
    flag = false
    worker?.kill()
}

module.exports = {
    enable, disable, destroy,
}
