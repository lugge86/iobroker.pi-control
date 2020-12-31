#!/usr/bin/python

import socket
import json

import os
import subprocess
import re

import signal
import sys

UDP_PORT_NO = 2222

serverSocket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
serverSocket.bind(('', UDP_PORT_NO))

cmdTableMonitor = {
    "cpu": {
        "cpu_frequency": {
            "command": "test -r /sys/devices/system/cpu/cpufreq/policy0/cpuinfo_cur_freq && cat /sys/devices/system/cpu/cpufreq/policy0/cpuinfo_cur_freq || test -r /sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq && cat /sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq || echo -1000",
            "regexp": "(.*)",
            "post": "$1/1000"
        },
        "load1,load5,load15": {
            "command": "cat /proc/loadavg",
            "regexp": "^(\\S+)\\s(\\S+)\\s(\\S+)",
            "post": ""
        },
        "scaling_governor": {
            "command": "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor",
            "regexp": "(.*)",
            "post": ""
        }
    },
    "raspberry": {
        "cpu_voltage": {
            "command": "vcgencmd measure_volts core",
            "regexp": "(\\d+.\\d+)V",
            "post": ""
        },
        "mem_arm": {
            "command": "vcgencmd get_mem arm",
            "regexp": "(\\d+)",
            "post": ""
        },
        "mem_gpu": {
            "command": "vcgencmd get_mem gpu",
            "regexp": "(\\d+)",
            "post": ""
        }
    },
    "memory": {
        "memory_total": {
            "command": "cat /proc/meminfo",
            "regexp": "MemTotal:\\s+(\\d+)",
            "post": "$1/1024"
        },
        "memory_free": {
            "command": "cat /proc/meminfo",
            "regexp": "MemFree:\\s+(\\d+)",
            "post": "$1/1024"
        },
        "memory_available": {
            "command": "cat /proc/meminfo",
            "regexp": "MemAvailable:\\s+(\\d+)",
            "post": "$1/1024",
            "multiline": True
        }
    },
    "network": {
        "net_received": {
            "command": "cat /sys/class/net/eth0/statistics/rx_bytes",
            "regexp": "(.*)",
            "post": "$1*-1"
        },
        "net_send": {
            "command": "cat /sys/class/net/eth0/statistics/tx_bytes",
            "regexp": "(.*)",
            "post": ""
        }
    },
    "sdcard": {
        "sdcard_root_total": {
            "command": "df /",
            "regexp": "\\S+\\s+(\\d+).*\\/$",
            "post": "$1/1024",
            "multiline": True
        },
        "sdcard_boot_total": {
            "command": "df /boot",
            "regexp": "\\S+\\s+(\\d+).*\\/boot$",
            "post": "$1/1024",
            "multiline": True
        },
        "sdcard_root_used": {
            "command": "df /",
            "regexp": "\\S+\\s+\\d+\\s+(\\d+).*\\/$",
            "post": "$1/1024",
            "multiline": True
        },
        "sdcard_boot_used": {
            "command": "df /boot",
            "regexp": "\\S+\\s+\\d+\\s+(\\d+).*\\/boot$",
            "post": "$1/1024",
            "multiline": True
        }
    },
    "swap": {
        "swap_total": {
            "command": "cat /proc/meminfo",
            "regexp": "SwapTotal:\\s+(\\d+)",
            "post": "$1/1024",
            "multiline": True
        },
        "swap_used": {
            "command": "cat /proc/meminfo",
            "regexp": "SwapFree:\\s+(\\d+)",
            #TODO: "post": "(rpi.swap_total - $1)/1024",
            "post": "$1/1024",
            "multiline": True
        }
    },
    "temperature": {
        "soc_temp": {
            "command": "cat /sys/devices/virtual/thermal/thermal_zone0/temp",
            "regexp": "(.*)",
            "post": "$1/1000"
        }
    },
    "uptime": {
        "uptime": {
            "command": "cat /proc/uptime",
            "regexp": "(^\\S+)",
            "post": ""
        }
    },
    "wlan": {
        "wifi_received": {
            "command": "cat /sys/class/net/wlan0/statistics/rx_bytes",
            "regexp": "(.*)",
            "post": "$1*-1"
        },
        "wifi_send": {
            "command": "cat /sys/class/net/wlan0/statistics/tx_bytes",
            "regexp": "(.*)",
            "post": ""
        }
    }
}


    
#s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
#conn = None

#signal.signal(signal.SIGINT, signal_handler)


def main():
    while 1:
        while 1:
            data, address = serverSocket.recvfrom(1024)
            
            request = json.loads(data)
            sendResponse = False;
            response = {}            
                        
            if not data:
                break

            if request["cmd"] == "shutdown":
                print("shutting down...")
                os.system('sudo shutdown now')
                
            elif request["cmd"] == "test":
                print("received test")
                
            elif request["cmd"] == "serverInfo":
                sendResponse = True
                response["data"] = {}
                response["data"]["version"] = "0.0.1"
                response["success"] = True
                
            elif request["cmd"] == "monitor":
                sendResponse = True
                
                try:
                    response["data"] = ProcessCmdMonitor(request["param"])
                except:
                    print("cannot process command " + request["cmd"])
                    sys.exc_info()[0]
                    response["success"] = False
                else:
                    response["success"] = True
                
            elif request["cmd"] == "uname":
                #print("received uname")
                p = subprocess.Popen(["uname", "-a"], stdout=subprocess.PIPE, shell=False)
                #print("1: ", p.stdout.read() )
                p.wait()
                print("2: ", p.stdout.read() )
                
            else:
                print("unknown command")
                print(request["cmd"])
                
            
            if sendResponse is True:
                response["cmd"] = request["cmd"]
                response["id"] = request["id"]
                serverSocket.sendto( json.dumps(response) , address)
                

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



def ProcessCmdMonitor(param):

    response = []

    for component, value in param["components"].items():
        if value is True:
            #print("Executing commands for component " + component)
            
            comp = {}
            comp["name"] = component
            comp["data"] = []
            
            for cmd, cmdCfg in cmdTableMonitor[component].items():
                
                command = cmdCfg["command"]
                regexp = cmdCfg["regexp"]
                post = cmdCfg["post"]
                
                stdout = os.popen( command ).read()
                val = (re.search( regexp, stdout)).group(1)
                
                if "$1" in post:
                    post = post.replace("$1", val)
                    val = eval(post)
                    
                #print( cmd + ": ", val, type(val) )compData = {}
                cmdData = {}
                cmdData["name"] = cmd
                cmdData["value"] = val
                comp["data"].append(cmdData)
            
            response.append(comp)
            
    return response
                
                
    
    #for key, cmd in table["cpu"].items():
    #    stdout = os.popen( cmd["command"] ).read()
    #    m = (re.search( cmd["regexp"], stdout)).group(0)
    #    print(m)
    
    
    

p = None
videoProc = None
if __name__ == "__main__":
    # execute only if run as a script
    main()
