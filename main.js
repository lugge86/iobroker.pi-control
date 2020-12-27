"use strict";

/*
 * Created with @iobroker/create-adapter v1.26.3
 */

const utils = require("@iobroker/adapter-core");
//const exec = require('child_process').exec;
const schedule = require('node-schedule');
const ping = require('ping');
const udp = require('dgram');
const buffer = require('buffer');


class PiControl extends utils.Adapter {
    
    /* possible states of the Pi state machine */
    piStates = {
        off: 1,
        waitingForOn: 2,
        on: 3,
        waitingForShutdown: 4,
        waitingDelayOff: 5,
        waitingDelayDecharge: 6,
        recovery: 7
    };
    
    piPlugId = "linkeddevices.0.Plug.Ambilight";
    delayStartup = (60000 * 2);
    delayRecovery = (150000);
    delayOff = 8000;
    delayDecharge = 5000;
    autoRecovery = true;
    
    piServer = udp.createSocket('udp4');

    
    constructor(options) {
        super({
            ...options,
            name: "pi-control",
        });
        this.on("ready", this.AdapterInit.bind(this));
        this.on("stateChange", this.StateChangeCallback.bind(this));
        this.on("unload", this.AdapterShutdown.bind(this));
        
        /* initialize flags */
        this.piState = this.piStates.off;
        this.piAlive = false;
        this.piAliveOld = false;
        
        this.mainTimer = null;
        
        
        this.piServer.on('message', function(msg,info){
            this.log.debug('Msg received: ' + msg.toString() + " " + msg.length + " " + info.address + " " + info.port);
            console.log('Received %d bytes from %s:%d\n',msg.length, info.address, info.port);
        });
        
    }

    
    async AdapterInit() {
        
        this.CreateStates();
        
        this.startupTimer = new Timer(this.delayStartup, this.MainFunction.bind(this) );
        this.recoveryTimer = new Timer(this.delayRecovery, this.MainFunction.bind(this) );
        this.offTimer = new Timer(this.delayOff, this.MainFunction.bind(this) );
        this.dechargeTimer = new Timer(this.delayDecharge, this.MainFunction.bind(this) );
        
        if (this.ConfigSanityCheck(this.config) == true) {
            /* all further work is handled by or main function, which needs to be called cyclically */
            this.MainFunction();
            this.mainTimer = schedule.scheduleJob("*/5 * * * * *", this.MainFunction.bind(this)  );
        } else {
            this.log.error("Config not valid, aborting!");
        }
    }
    

    AdapterShutdown(callback) {
        try {
            callback();
        } catch (e) {
            callback();
        }
    }
    
    
    MainFunction() {
        /* do all our cyclic stuff here */
        this.ProcessStateMachine();
        this.CheckPiAlive();
    }
    
   
    ProcessStateMachine() {
        /* actions depend on current state */
        switch(this.piState) {
            case this.piStates.off: {
                if (this.piSwitched == true) {
                    /* user wants to switch on the pi, thus, switch on relay */
                    this.setForeignState(this.piPlugId, true);
                    this.piSwitched = false;
                    this.startupTimer.Start();
                    
                    this.log.info("state change: off => waitingForOn");
                    this.piState = this.piStates.waitingForOn;
                    
                } else if (this.piAlive == true) {
                    /* seems that someone switched on the pi directly */
                    this.setState("Switch", this.piState, true);
                    
                    this.log.info("state change: off => on");
                    this.piState = this.piStates.on;
                }
                break;
            }

            case this.piStates.waitingForOn: {
                /* in this state, we wait till the pi has booted */
                if (this.piAlive == true) {
                    /* seems that the pi has finished booting */
                    this.startupTimer.Stop();
                    
                    this.log.info("state change: waitingForOn => on");
                    this.piState = this.piStates.on;
                    
                } else if ( this.startupTimer.IsFinished() == true) {
                    this.log.error("seems the pi won't start up...");
                    
                    this.log.info("state change: waitingForOn => recovery");
                    this.piState = this.piStates.recovery;                
                }
                break;
            }

            /* this is the normal state where we wait for shutdown comments */
            case this.piStates.on: {
                
                if (this.piSwitched == true) {
                    /* shutdown triggered by user */
                    this.piSwitched = false;
                    this.CommandShutdown();
                    
                    this.log.info("state change: on => waitingForShutdown");
                    this.piState = this.piStates.waitingForShutdown;
                    
                } else if ( (this.piAlive == false) && ( this.recoveryTimer.IsRunning() == false ) ) {
                    this.log.info("pi seems no longer reachable, starting recovery timer before taking actions");
                    this.recoveryTimer.Start();
                    
                } else if ( (this.piAlive == false) && (this.recoveryTimer.IsFinished() == true) ) {
                    this.log.info("state change: on => recovery");
                    this.piState = this.piStates.recovery;
                    
                } else if ( (this.piAlive == true) && ( this.recoveryTimer.IsRunning() ) ){
                    this.log.info("pi is reachable again, aborting recovery timer");
                    this.recoveryTimer.Stop();
                }

                break;
            }

            /* here we wait till the pi is no longer reachable via network */
            case this.piStates.waitingForShutdown: {                
                
                if (this.piAlive == false) {
                    this.offTimer.Start();
                    
                    this.log.info("state change: waitingForShutdown => waitingDelayOff");
                    this.piState = this.piStates.waitingDelayOff;
                }
                //todo: timeout
                break;
            }

            /* here we wait another short delay to make sure the pi is really shut down */
            case this.piStates.waitingDelayOff: {
                if (this.offTimer.IsFinished() == true) {
                    this.setForeignState(this.piPlugId, false);
                    this.dechargeTimer.Start();

                    this.log.info("state change: waitingDelayOff => waitingDelayDecharge");
                    this.piState = this.piStates.waitingDelayDecharge;
                }
                break;
            }
            
            case this.piStates.waitingDelayDecharge: {
                if (this.dechargeTimer.IsFinished() == true) {
                    
                    this.log.info("state change: waitingDelayDecharge => off");
                    this.piState = this.piStates.off;                
                }
                break;
            }
            
            case this.piStates.recovery: {
                if (this.autoRecovery == true) {
                    
                    this.setForeignState(this.piPlugId, false);
                    this.dechargeTimer.Start();
                    
                    this.log.info("state change: recovery => waitingDelayDecharge");
                    this.piState = this.piStates.waitingDelayDecharge;
                }
                break;
            }

            default: {
                this.log.error("default branch should never be reached, check your script");
                this.piState = this.piStates.off;
                break;
            }
        }
        
        this.setState("internal.piState", this.piState, true);
    }
    
    
    StateChangeCallback(id, state) {
        if (state) {
            
            /* we do only stuff when the state change was triggered by user (ack is not set) */
            if (state.ack == false) {            
                /* actions are depending on state */
                switch( this.IdWithoutPath(id) ){
                    case "Switch": {
                        this.ProcessTriggerSwitch(state);
                        break;
                    }
                    case "EmergencyShutdown": {
                        this.ProcessTriggerEmergencyShutdown(state);
                        break;
                    }                
                    default: {
                        break;
                    }
                }
            }
        } else {
            /* seems that the state was deleted */
            this.log.info(`state ${id} deleted`);
        }
    }
    
    
    ProcessTriggerSwitch(state) {
        if(state.val == true)
        {
            /* accept triggers only in on and off states */
            if ( (this.piState == this.piStates.off) || (this.piState == this.piStates.on) ) {
                /* set switch flag and call state machine directly, for faster execution */
                this.piSwitched = true;
            } else {
                /* in intermediate states, the "button" is blocked */
                this.log.info("switching is not allowed at the moment");
            }
            this.setState("Switch", false);    
        }
    }
    
    
    CommandShutdown() {
        this.SendToServer("shutdown");
    }
    
    
    SendToServer(data) {
        
        var mybuf = Buffer.from(data);
        
        this.piServer.send( mybuf, 2222,'192.168.0.108', (error) => {
            if (error) {
                this.piServer.close();
            } else {
                this.log.info('Data sent !!!');
            }
        });
    }
    
    
    
    ProcessTriggerEmergencyShutdown(state) {
        /* Todo: EmergencyShutdown is not supported at the moment */
        if ( (state.val == true) && (state.old_val == false) ) {                        
        }
    }

    
    async CreateStates() {
        /* create states... */
        await this.setObjectNotExistsAsync("Switch", {type: "state", common: {name: "switch on and off the Pi", type: "boolean", role: "state", read: true, write: true } });
        await this.setObjectNotExistsAsync("internal.piState", {type: "state", common: {name: "state of the Pi state machine", type: "number", role: "state", read: true, write: false }, states: {1:"off", 2:"waitingForOn", 3:"on", 4:"waitingForShutdown", 5:"waitingDelayOff"} });
        await this.setObjectNotExistsAsync("internal.piAlive", {type: "state", common: {name: "Pi is reachable in network", type: "boolean", role: "state", read: true, write: false } });
        await this.setObjectNotExistsAsync("EmergencyShutdown", {type: "state", common: {name: "switch of the pi (the hard way)", type: "boolean", role: "switch", read: true, write: true } });
        
        /* ... and subscribe them */
        this.subscribeStates("Switch");
        this.subscribeStates("EmergencyShutdown");
    }
    
    
    ConfigSanityCheck(config) {
        /* Todo: configuration is not checked at the moment */
        return true;
    }
    
    
    CheckPiAlive() {
        /* we ping the pi to get the alive status */
        ping.sys.probe("192.168.0.108", (isAlive) => {
            if (isAlive) {
                this.piAlive = true;
            } else {
                this.piAlive = false;
            }
            
            /* logging and messaging is only done when state changes */
            if ( (this.piAlive == true) && (this.piAliveOld == false) ) {
                this.log.info("found pi alive");
                this.setState("internal.piAlive", this.piAlive, true);
            }
            if ( (this.piAlive == false) && (this.piAliveOld == true) ) {
                this.log.info("pi is no longer reachable");
                this.setState("internal.piAlive", this.piAlive, true);
            }
            this.piAliveOld = this.piAlive;
        } );
    }
    
    
    IdWithoutPath(id) {
        /* this will return only the last part of the state id */
        return id.split(".").pop();
    }
}



class Timer {
    
    constructor(timeout, callback) {
        this.timeout = timeout;
        this.callback = callback;
        this.timer = null;
        this.finished = false;
    }
    
    Start() {
        this.timer = setTimeout( () => {
            this.finished = true;
            if (this.callback) {
                this.callback()
            }
        }, this.timeout);
    }
    
    Stop() {
        clearTimeout(this.timer);
        this.timer = null;
    }
    
    IsFinished() {
        var ret = this.finished;
        this.finished = false;
        return ret;
    }
    
    IsRunning() {
        var ret = false;
        if (this.timer) {
            ret = true;
        }
        return ret;
    }
}




// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new PiControl(options);
} else {
    // otherwise start the instance directly
    new PiControl();
}
