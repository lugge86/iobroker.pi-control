#!/bin/bash

cp pi-control.service /etc/systemd/system/
chown root:root /etc/systemd/system/pi-control.service
chmod 644 /etc/systemd/system/pi-control.service
