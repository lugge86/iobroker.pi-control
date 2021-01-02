#!/bin/bash

sudo cp ../pi-control.service pi-control/etc/systemd/system/
sudo chown root:root pi-control/etc/systemd/system/pi-control.service
sudo chmod 644 pi-control/etc/systemd/system/pi-control.service


sudo cp ../pi-control-server.py pi-control/usr/local/lib/pi-control/
sudo chown root:root pi-control/usr/local/lib/pi-control/pi-control-server.py
sudo chmod 644 pi-control/usr/local/lib/pi-control/pi-control-server.py

dpkg-deb --build pi-control
