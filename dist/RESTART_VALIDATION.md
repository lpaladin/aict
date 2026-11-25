# AICT 重启故障与恢复

日期：2026-11-18，Asia/Shanghai。

## 故障证据

读取手机对话 01a1ee80-5c00-79e0-8497-71446d5cea5f。
用户“可以重启”后，Agent 在一条Shell命令中先Stop-Process网关，再调用start-server.ps1。
命令313ms后失败退出，turn中断；旧PID37024不存在，HTTP127.0.0.1:18765拒绝连接。
停止网关也中断了执行重启命令的会话，后续启动没有完成。

## 恢复与防复发

先用正常用户环境启动恢复为PID7968，健康检查通过，真实手机在线。
新增service_lifecycle.py：网关直接启动独立Windows后台worker，避开Codex Shell执行作业的生命周期。
新增tools/restart-server.ps1：延迟4秒，核对目标PID与main.py命令行，停止该网关及其app-server子进程，启动并检查health。
phone_call支持service.restart，返回“已安排”与operationId，不能将安排成功表述为重启已完成。
PHONE.md与开发者上下文明确禁止在当前Agent Shell中停止自己的网关后再启动。
启动脚本增加PID身份检查和健康等待，启动失败给出错误而不是提前报告成功。
网页增加1至15秒退避自动重连；保留草稿、恢复选中对话，不自动重发消息或重复执行任务。

## 验证

- 独立worker实测：operationId1273896ba7714aa0bb7cf4b691c8f21f，PID7968→1200，状态completed。
- 状态文件：server/run/restart-1273896ba7714aa0bb7cf4b691c8f21f.json。
- /health返回ok=true，/api/devices确认真实手机已重新在线。
- 通过真实app-server thread/read成功读取原手机对话历史。
- 默认服务端测试：10项通过，1项可选真实Codex推理测试跳过。
- 浏览器模拟断线：自动恢复“已连接 · 设备工作空间”，选中fixture-thread保持，输入草稿保持。
- JavaScript语法与Python编译检查通过。

该测试直接实测worker停服、启动、健康流程；service.restart的工具路由通过单元测试。
没有为测试向用户原手机对话额外发送消息，也没有自动继续被中断的任务。
