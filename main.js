"use strict";

/*
 * Created with @iobroker/create-adapter v1.26.3
 */

const utils = require("@iobroker/adapter-core");
const exec = require('child_process').exec;
const schedule = require('node-schedule');
const ping = require('ping');


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
    delayRecovery = (150000);
    delayOff = 8000;
    delayDecharge = 5000;
    autoRecovery = true;

    
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
        this.recoveryTimer = null;
        this.offTimer = null;
        this.dechargeTimer = null;        
        this.recoveryTimerFinished = false;
        this.offTimerFinished = false;
        this.dechargeTimerFinished = false;
    }

    
    async AdapterInit() {
        
        this.CreateStates();
        
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
                    this.log.info("state change: waitingForOn => on");
                    this.piState = this.piStates.on;
                }
                //todo: timeout
                break;
            }

            /* this is the normal state where we wait for shutdown comments */
            case this.piStates.on: {
                
                if (this.piSwitched == true) {
                    /* shutdown triggered by user */
                    this.piSwitched = false;
                    exec('echo "shutdown" | nc 192.168.0.83  8080 -q 1');
                    
                    this.log.info("state change: on => waitingForShutdown");
                    this.piState = this.piStates.waitingForShutdown;
                } else if ( (this.piAlive == false) && (this.recoveryTimerFinished == true) ) {
                    this.recoveryTimerFinished = false;
                    this.log.info("state change: on => recovery");
                    this.piState = this.piStates.recovery;
                    
                } else if ( (this.piAlive == false) && !(this.recoveryTimer) ){
                    this.log.info("pi seems no longer reachable, starting recovery timer before taking actions");
                    this.recoveryTimerFinished = false;
                    this.recoveryTimer = setTimeout(this.RecoveryTimerClbk.bind(this), this.delayRecovery);
                    
                } else if ( (this.piAlive == true) && (this.recoveryTimer) ){
                    this.log.info("pi is reachable again, aborting recovery timer");
                    clearTimeout(this.recoveryTimer);
                    this.recoveryTimer = null;
                }

                break;
            }

            /* here we wait till the pi is no longer reachable via network */
            case this.piStates.waitingForShutdown: {                
                
                if (this.piAlive == false) {
                    this.offTimerFinished = false;
                    this.offTimer = setTimeout(this.OffTimerClbk.bind(this), this.delayOff);
                    
                    this.log.info("state change: waitingForShutdown => waitingDelayOff");
                    this.piState = this.piStates.waitingDelayOff;
                }
                //todo: timeout
                break;
            }

            /* here we wait another short delay to make sure the pi is really shut down */
            case this.piStates.waitingDelayOff: {            
                if (this.offTimerFinished == true) {
                    this.offTimerFinished = false;
                    this.setForeignState(this.piPlugId, false);                    
                    this.dechargeTimerFinished = false;
                    this.dechargeTimer = setTimeout(this.DechargeTimerClbk.bind(this), this.delayDecharge);

                    this.log.info("state change: waitingDelayOff => waitingDelayDecharge");
                    this.piState = this.piStates.waitingDelayDecharge;
                }
                break;
            }
            
            case this.piStates.waitingDelayDecharge: {
                if (this.dechargeTimerFinished == true) {
                    this.dechargeTimerFinished = false;
                    
                    this.log.info("state change: waitingDelayDecharge => off");
                    this.piState = this.piStates.off;                
                }
                break;
            }
            
            case this.piStates.recovery: {
                if (this.autoRecovery == true) {
                    
                    this.setForeignState(this.piPlugId, false);                    
                    this.dechargeTimerFinished = false;
                    this.dechargeTimer = setTimeout(this.DechargeTimerClbk.bind(this), this.delayDecharge);
                    
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
    
    
    ProcessTriggerEmergencyShutdown(state) {
        /* Todo: EmergencyShutdown is not supported at the moment */
        if ( (state.val == true) && (state.old_val == false) ) {                        
        }
    }
    
    
    RecoveryTimerClbk() {
        this.recoveryTimer = null;
        this.recoveryTimerFinished = true;
        this.ProcessStateMachine();
    }
    
    OffTimerClbk() {
        this.offTimer = null;
        this.offTimerFinished = true;
        this.ProcessStateMachine();
    }
    
    DechargeTimerClbk() {
        this.dechargeTimer = null;
        this.dechargeTimerFinished = true;
        this.ProcessStateMachine();
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
        ping.sys.probe("192.168.0.83", (isAlive) => {
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
