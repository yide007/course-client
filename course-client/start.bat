@echo off
set PATH=D:\node;%PATH%
cd /d "E:\Goproject\Goproject\course-client"
echo 正在启动课程客户端...
echo 如果启动失败，请确认 D:\node 目录下有 node.exe 和 npm
echo.
npm start
pause