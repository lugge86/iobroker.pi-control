#!/bin/bash

cp pi-control.service /etc/systemd/system/
chown root:root /etc/systemd/system/pi-control.service
chmod 644 /etc/systemd/system/pi-control.service

mkdir /usr/local/lib/pi-control
cp pi-control-server.py /usr/local/lib/pi-control/
chown root:root /usr/local/lib/pi-control/pi-control-server.py
chmod 644 /usr/local/lib/pi-control/pi-control-server.py
