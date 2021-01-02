
/* function is called by admin adapter and is responsible for setting up all widgets with user config */
function load(settings, onChange) {

    /* if no settings available, return because nothing to do */
    if (!settings) {
        return;
    }

    // example: select elements with id=key and class=value and insert value
    $('.value').each(function () {
        var $key = $(this);
        var id = $key.attr('id');
        if ($key.attr('type') === 'checkbox') {
            // do not call onChange direct, because onChange could expect some arguments
            $key.prop('checked', settings[id])
                .on('change', () => onChange())
                ;
        } else {
            // do not call onChange direct, because onChange could expect some arguments
            $key.val(settings[id])
                .on('change', () => onChange())
                .on('keyup', () => onChange())
                ;
        }
    });

    /* re-initialize labels */
    if (M) M.updateTextFields();
    
    /* save button is greyed out at the beginning */
    onChange(false);
}


/* function is called by admin adapter and is responsible for saving all user config */
function save(callback) {
    
    /* create object for holding the user config */
    var adapterConfig = {};

    /* all input values tagged as "value" can directly be stored in our config object */
    $('.value').each(function () {
        var $this = $(this);

        /* checkboxes need further treatment */
        if ($this.attr('type') === 'checkbox') {
            adapterConfig[$this.attr('id')] = $this.prop('checked');
        } else {
            adapterConfig[$this.attr('id')] = $this.val();
        }
    });
        
    callback(adapterConfig);
    
    /* before storing the config object via the callback, ask adapter backend if the config is valid */    
//     sendTo(adapter + "." + instance, 'ConfigSanityCheck', adapterConfig, isSane => {
//         if (isSane) {
//             /* config object is valid and can be stored permanently */
//             callback(adapterConfig);
//         } else {
//             /* show error dialog */
//             $('#dialog_info').modal({
//                 startingTop: '4%',
//                 endingTop: '10%',
//                 dismissible: false
//             });
// 
//             $('#dialog_info').modal('open');
//             Materialize.updateTextFields();
//         }
//     });
}

