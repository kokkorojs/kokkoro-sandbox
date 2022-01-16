# kokkoro-sendbox

将收到的消息当做代码在沙盒中执行，并返回结果（魔改自 [takayamabot](https://github.com/takayama-lily/takayamabot)）

## 安装

``` shell
# 切换至 bot 目录
cd bot

# 安装 npm 包
npm i kokkoro-sandbox
```

在 [kokkoro](https://github.com/kokkorojs/kokkoro) 成功运行并登录后，发送 `>enable sandbox` 即可启用插件  
使用 `>sandbox <key> <value>` 可修改当前群聊的插件参数，例如关闭当前群聊沙盒 `>sandbox apply false`