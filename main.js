"use strict";

/*
 * Created with @iobroker/create-adapter v1.26.3
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const exec = require('child_process').exec;
const schedule = require('node-schedule');

// Load your modules here, e.g.:
// const fs = require("fs");

class PiControl extends utils.Adapter {
    
    
    piStates = {
        off: 1,
        waitingForOn: 2,
        on: 3,
        waitForShutdown: 4,
        waitDelay: 5
    };
    
    piPlugId = "linkeddevices.0.Plug.Ambilight";
    delay1 = 8000;
    delay2 = 5000; // not used at the moment

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "pi-control",
        });
        this.on("ready", this.AdapterInit.bind(this));
        this.on("stateChange", this.StateChangeCallback.bind(this));
        this.on("unload", this.AdapterShutdown.bind(this));
        
        this.piState = this.piStates.off;
        this.piAlive = false;
        this.cycleTimer = null;
    }

    
    async AdapterInit() {
        
        this.CreateStates();
        
        if (this.ConfigSanityCheck(this.config) == true) {
            /* all further work is handled by or main function, which needs to be called cyclically */
            this.MainFunction();
            this.cycleTimer = schedule.scheduleJob("*/5 * * * * *", this.MainFunction.bind(this)  );
        } else {
            this.log.info("Config not valid, aborting!");
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
                    this.log.info("switching states [off => waitingForOn]");
                    this.piState = this.piStates.waitingForOn;
                    
                } else if (this.piAlive == true) {
                    /* seems that someone switched on the pi directly */
                    this.log.info("switching states [off => on]");
                    this.piState = this.piStates.on;
                }
                break;
            }

            case this.piStates.waitingForOn: {
                /* in this state, we wait till the pi has booted */
                if (this.piAlive == true) {
                    /* seems that the pi has finished booting */
                    this.log.info("switching states [waitingForOn => on]");
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
                    this.log.info("switching states [on => waitingForShutdown]");
                    this.piState = this.piStates.waitForShutdown;
                    
                } else if (this.piAlive == false) {
                    /* seems that someone shut down the pi */
                    this.log.info("switching states [on => waitDelay]");
                    this.piState = this.piStates.waitDelay;
                }
                break;
            }

            /* here we wait till the pi is no longer reachable via network */
            case this.piStates.waitForShutdown: {
                
                if (this.piAlive == false) {
                    this.timeout = setTimeout(this.TimeoutCallback.bind(this), this.delay1);
                    this.log.info("switching states [waitForShutdown => waitDelay]");
                    this.piState = this.piStates.waitDelay;
                }
                //todo: timeout
                break;
            }

            /* here we wait another short delay to make sure the pi is really shut down */
            case this.piStates.waitDelay: {            
                if (this.timeoutOccured == true) {
                    this.timeoutOccured = false;
                    this.setForeignState(this.piPlugId, false);

                    this.log.info("switching states [waitDelay => off]");
                    this.piState = piStates.off;
                }
                break;
            }

            default: {
                this.log.info("default branch should never be reached, check your script");
                this.piState = this.piStates.off;
                break;
            }
        }
        
        this.setState("internal.piState", this.piState, true);
    }
    
    
    StateChangeCallback(id, state) {
        if (state) {
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
            
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
    
    
    ProcessTriggerSwitch(state) {
        if(state.val == true)
        {
            /* accept triggers only in on and off states */
            if ( (this.piState == this.piStates.off) || (this.piState == this.piStates.on) )
            {
                /* set switch flag and call state machine directly, for faster execution */
                this.piSwitched = true;
            }
            else
            {
                /* in intermediate states, the "button" is blocked */
                this.log.info("switching is not allowed at the moment");
            }
            this.setState("Switch", false);    
        }
    }
    
    
    ProcessTriggerEmergencyShutdown(state) {
        if ( (state.val == true) && (state.old_val == false) ) {                        
        }
    }
    
    
    TimeoutCallback() {
        this.timeoutOccured = true;
        this.ProcessStateMachine();
    }
    
    
    async CreateStates() {
        await this.setObjectNotExistsAsync("Switch", {type: "state", common: {name: "switch on and off the Pi", type: "boolean", role: "button", read: true, write: true } });
        await this.setObjectNotExistsAsync("internal.piState", {type: "state", common: {name: "state of the Pi state machine", type: "number", role: "state", read: true, write: false } });
        await this.setObjectNotExistsAsync("internal.piAlive", {type: "state", common: {name: "Pi is reachable in network", type: "boolean", role: "state", read: true, write: false } });
        await this.setObjectNotExistsAsync("EmergencyShutdown", {type: "state", common: {name: "switch of the pi (the hard way)", type: "boolean", role: "switch", read: true, write: true } });
        
        this.subscribeStates("Switch");
        this.subscribeStates("EmergencyShutdown");
    }
    
    
    ConfigSanityCheck(config) {
        return true;
    }
    
    
    CheckPiAlive() {
        exec('echo "test" | nc 192.168.0.83  8080 -q 1', (error, result, stderr) => {
            if (error) {
                this.piAlive = false;                
            } else {
                this.piAlive = true;                
            }
            this.setState("internal.piAlive", this.piAlive, true);
        });
    }
    
    
    IdWithoutPath(id) {
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
