#!/usr/bin/python

import socket
import os
import subprocess

import signal
import sys

UDP_PORT_NO = 2222

serverSocket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
serverSocket.bind(('', UDP_PORT_NO))


    
#s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
#conn = None

#signal.signal(signal.SIGINT, signal_handler)


def main():
    while 1:
        while 1:
            data = serverSocket.recv(100)
            if not data:
                break

            if data == "shutdown\n":
                print("shutting down...")
                os.system('sudo shutdown now')
            elif data == "test\n":
                print("received test")
                True
            elif data == "video1\n":
                PlayVideo("https://www.youtube.com/watch?v=hlWiI4xVXKY")
            elif data == "video2\n":
                PlayVideo("https://www.youtube.com/watch?v=3cfFMcj4Guw")
            elif data == "video3\n":
                PlayVideo("https://www.youtube.com/watch?v=8j8oDOVBWkM")

                
            elif data == "stopvideo\n":
                StopVideo()

                
                
            elif data == "uname\n":
                #print("received uname")
                p = subprocess.Popen(["uname", "-a"], stdout=subprocess.PIPE, shell=False)
                #print("1: ", p.stdout.read() )
                p.wait()
                print("2: ", p.stdout.read() )
            else:
                print("unknown command")
        #print("connection closed by peer...")

    conn.close()



def signal_handler(sig, frame):
    print('You pressed Ctrl+C!')
    if (conn):
        conn.close()
    sys.exit(0)


def StopVideo():
    global videoProc
    
    if ( (videoProc) and (videoProc.returncode == None)):
        print("trying to stop playing video...")
        videoProc.terminate()
        videoProc.wait()
        print("video stopped!")
    else:
        print("no video playing")
    
def PlayVideo(video):
    global videoProc
    
    StopVideo()
    print("starting video: ", video)
    videoProc = subprocess.Popen(["cvlc", "--preferred-resolution", "-1", video], stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False)


p = None
videoProc = None
if __name__ == "__main__":
    # execute only if run as a script
    main()
