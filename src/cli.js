/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

/* jshint node:true, bitwise:true, undef:true, trailing:true, quotmark:true,
          indent:4, unused:vars, latedef:nofunc,
          laxcomma:true
*/


var path = require('path'),
    fs = require('fs'),
    help = require('./help'),
    nopt,
    _,
    updateNotifier,
    pkg = require('../package.json'),
    telemetry = require('./telemetry'),
    Q = require('q');
var { prefix } = require('./utils/npm');

var cordova_lib = require('../lib'),
    CordovaError = cordova_lib.CordovaError,
    WeexpackError = cordova_lib.CordovaError,
    cordova = cordova_lib.cordova,
    events = cordova_lib.events,
    logger = require('weexpack-common').CordovaLogger.get();


/*
 * init
 *
 * initializes nopt and underscore
 * nopt and underscore are require()d in try-catch below to print a nice error
 * message if one of them is not installed.
 */
function init() {
    try {
        nopt = require('nopt');
        _ = require('underscore');
        updateNotifier = require('update-notifier');
    } catch (e) {
        console.error(
            'Please run npm install from this directory:\n\t' +
            path.dirname(__dirname)
        );
        process.exit(2);
    }
}

function checkForUpdates() {
    try {
        // Checks for available update and returns an instance
        var notifier = updateNotifier({
            pkg: pkg
        });

        // Notify using the built-in convenience method
        notifier.notify();
    } catch (e) {
        // https://issues.apache.org/jira/browse/CB-10062
        if (e && e.message && /EACCES/.test(e.message)) {
            console.log('Update notifier was not able to access the config file.\n' +
                'You may grant permissions to the file: \'sudo chmod 744 ~/.config/configstore/update-notifier-cordova.json\'');
        } else {
            throw e;
        }
    }
}

var shouldCollectTelemetry = false;
module.exports = function (inputArgs, cb) {

    /**
     * mainly used for testing.
     */
    cb = cb || function(){};

    init();

    // If no inputArgs given, use process.argv.
    inputArgs = inputArgs || process.argv;
    var cmd = inputArgs[2]; // e.g: inputArgs= 'node cordova run ios'
    var subcommand = getSubCommand(inputArgs, cmd);
    var isTelemetryCmd = (false && cmd === 'telemetry');

    // ToDO: Move nopt-based parsing of args up here
    if(cmd === '--version' || cmd === '-v') {
        cmd = 'version';
    } else if(!cmd || cmd === '--help' || cmd === 'h') {
        cmd = 'help';
    }

    Q().then(function (collectTelemetry) {
        shouldCollectTelemetry = collectTelemetry;
        if(isTelemetryCmd) {
            return Q();
        }
        return cli(inputArgs);
    }).then(function () {
        if (shouldCollectTelemetry && !isTelemetryCmd) {
            telemetry.track(cmd, subcommand, 'successful');
        }
        // call cb with error as arg if something failed
        cb(null);
    }).fail(function (err) {
        if (shouldCollectTelemetry && !isTelemetryCmd) {
            telemetry.track(cmd, subcommand, 'unsuccessful');
        }
        // call cb with error as arg if something failed
        cb(err);
        throw err;
    }).done();
};

function getSubCommand(args, cmd) {
    var subCommands = [
        'platform',
        'platforms',
        'plugin',
        'plugins',
       // 'telemetry'
    ];
    if(subCommands.indexOf(cmd)) {
        return args[3];
    }
    return null;
}

function handleTelemetryCmd(subcommand, isOptedIn) {

    if (subcommand !== 'on' && subcommand !== 'off') {
        logger.subscribe(events);
        return help(['telemetry']);
    }

    var turnOn = subcommand === 'on' ? true : false;
    var cmdSuccess = true;

    // turn telemetry on or off
    try {
        if (turnOn) {
            telemetry.turnOn();
            console.log("Thanks for opting into telemetry to help us improve weexpack.");
        } else {
            telemetry.turnOff();
            console.log("You have been opted out of telemetry. To change this, run: weexpack telemetry on.");
        }
    } catch (ex) {
        cmdSuccess = false;
    }

    // track or not track ?, that is the question

    if (!turnOn) {
        // Always track telemetry opt-outs (whether user opted out or not!)
        telemetry.track('telemetry', 'off', 'via-cordova-telemetry-cmd', cmdSuccess ? 'successful': 'unsuccessful');
        return Q();
    }

    if(isOptedIn) {
        telemetry.track('telemetry', 'on', 'via-cordova-telemetry-cmd', cmdSuccess ? 'successful' : 'unsuccessful');
    }

    return Q();
}

function cli(inputArgs) {
    // When changing command line arguments, update doc/help.txt accordingly.
    var knownOpts =
        { 'verbose' : Boolean
        , 'version' : Boolean
        , 'help' : Boolean
        , 'silent' : Boolean
        , 'experimental' : Boolean
        , 'noregistry' : Boolean
        , 'nohooks': Array
        , 'shrinkwrap' : Boolean
        , 'copy-from' : String
        , 'link-to' : path
        , 'searchpath' : String
        , 'variable' : Array
        , 'link': Boolean
        , 'force': Boolean
        // Flags to be passed to `cordova build/run/emulate`
        , 'debug' : Boolean
        , 'release' : Boolean
        , 'market':String
        , 'archs' : String
        , 'device' : Boolean
        , 'emulator': Boolean
        , 'target' : String
        , 'browserify': Boolean
        , 'noprepare': Boolean
        , 'fetch': Boolean
        , 'nobuild': Boolean
        , 'list': Boolean
        , 'buildConfig' : String
        , 'template' : String
        , 'ali' : Boolean

        };

    var shortHands =
        { 'd' : '--verbose'
        , 'v' : '--version'
        , 'h' : '--help'
        , 'src' : '--copy-from'
        , 't' : '--template'
        , 'a' : '--ali'
        };

    checkForUpdates();

    var args = nopt(knownOpts, shortHands, inputArgs);
    // For CordovaError print only the message without stack trace unless we
    // are in a verbose mode.
    process.on('uncaughtException', function(err) {
        logger.error(err);
        // Don't send exception details, just send that it happened
        if(shouldCollectTelemetry) {
            telemetry.track('uncaughtException');
        }
        process.exit(1);
    });

    logger.subscribe(events);

    if (args.silent) {
        logger.setLevel('error');
    }

    if (args.verbose) {
        logger.setLevel('verbose');
    }

    var cliVersion = require('../package').version;
    // TODO: Use semver.prerelease when it gets released
    var usingPrerelease = /-nightly|-dev$/.exec(cliVersion);
    if (args.version || usingPrerelease) {
        var libVersion = require('cordova-lib/package').version;
        var toPrint = cliVersion;
        if (cliVersion != libVersion || usingPrerelease) {
            toPrint += ' (cordova-lib@' + libVersion + ')';
        }

        if (args.version) {
            logger.results(toPrint);
            return Q();
        } else {
            // Show a warning and continue
            logger.warn('Warning: using prerelease version ' + toPrint);
        }
    }

    if (/^v0.\d+[.\d+]*/.exec(process.version)) { // matches v0.*
        var msg = 'Warning: using node version ' + process.version +
                ' which has been deprecated. Please upgrade to the latest node version available (v6.x is recommended).';
        logger.warn(msg);
    }

    // If there were arguments protected from nopt with a double dash, keep
    // them in unparsedArgs. For example:
    // cordova build ios -- --verbose --whatever
    // In this case "--verbose" is not parsed by nopt and args.vergbose will be
    // false, the unparsed args after -- are kept in unparsedArgs and can be
    // passed downstream to some scripts invoked by Cordova.
    var unparsedArgs = [];
    var parseStopperIdx =  args.argv.original.indexOf('--');
    if (parseStopperIdx != -1) {
        unparsedArgs = args.argv.original.slice(parseStopperIdx + 1);
    }

    // args.argv.remain contains both the undashed args (like platform names)
    // and whatever unparsed args that were protected by " -- ".
    // "undashed" stores only the undashed args without those after " -- " .
    var remain = args.argv.remain;
    var undashed = remain.slice(0, remain.length - unparsedArgs.length);
    var cmd = undashed[0];
    var subcommand;
    var msg;
    var known_platforms = Object.keys(cordova_lib.cordova_platforms);

    if ( !cmd || cmd == 'help' || args.help ) {
        if (!args.help && remain[0] == 'help') {
            remain.shift();
        }
        return help(remain);
    }

    if ( !cordova.hasOwnProperty(cmd) ) {
        msg =
            'weexpack doesn\'t know command: ' + cmd + '; try ` weexpack help` for a list of all the available commands.';
        throw new WeexpackError(msg);
    }

    var opts = {
        platforms: [],
        options: [],
        verbose: args.verbose || false,
        silent: args.silent || false,
        browserify: args.browserify || false,
        fetch: args.fetch || false,
        nohooks: args.nohooks || [],
        searchpath : args.searchpath,
        ali:args.ali
    };

    var cmdList = [
      'emulate',
     // 'build',
     //  'run'
      'prepare',
      'compile',
      'clean'
    ];

    if (cmdList.indexOf(cmd)>=0) {
        // All options without dashes are assumed to be platform names
        opts.platforms = undashed.slice(1);
        var badPlatforms = _.difference(opts.platforms, known_platforms);
        if( !_.isEmpty(badPlatforms) ) {
            msg = 'Unknown platforms: ' + badPlatforms.join(', ');
            throw new WeexpackError(msg);
        }

        // Pass nopt-parsed args to PlatformApi through opts.options
        opts.options = args;
        opts.options.argv = unparsedArgs;

        if (cmd === 'run' && args.list && cordova.raw.targets) {
            return cordova.raw.targets.call(null, opts);
        }

        return cordova.raw[cmd].call(null, opts);
    } else if (cmd === 'requirements') {
        // All options without dashes are assumed to be platform names
        opts.platforms = undashed.slice(1);
        var badPlatforms = _.difference(opts.platforms, known_platforms);
        if( !_.isEmpty(badPlatforms) ) {
            msg = 'Unknown platforms: ' + badPlatforms.join(', ');
            throw new CordovaError(msg);
        }

        return cordova.raw[cmd].call(null, opts.platforms)
            .then(function(platformChecks) {

                var someChecksFailed = Object.keys(platformChecks).map(function(platformName) {
                    events.emit('log', '\nRequirements check results for ' + platformName + ':');
                    var platformCheck = platformChecks[platformName];
                    if (platformCheck instanceof CordovaError) {
                        events.emit('warn', 'Check failed for ' + platformName + ' due to ' + platformCheck);
                        return true;
                    }

                    var someChecksFailed = false;
                    platformCheck.forEach(function(checkItem) {
                        var checkSummary = checkItem.name + ': ' +
                            (checkItem.installed ? 'installed ' : 'not installed ') +
                            (checkItem.metadata.version || '');
                        events.emit('log', checkSummary);
                        if (!checkItem.installed) {
                            someChecksFailed = true;
                            events.emit('warn', checkItem.metadata.reason);
                        }
                    });

                    return someChecksFailed;
                }).some(function(isCheckFailedForPlatform) {
                    return isCheckFailedForPlatform;
                });

                if (someChecksFailed) throw new CordovaError('Some of requirements check failed');
            });
    } else if (cmd == 'serve') {
        var port = undashed[1];
        return cordova.raw.serve(port);
    } else if (cmd == 'create') {
        return create();
    } else {
        // platform/plugins add/rm [target(s)]
        subcommand = undashed[1]; // sub-command like "add", "ls", "rm" etc.
        var targets = undashed.slice(2); // array of targets, either platforms or plugins
        var cli_vars = {};
        if (args.variable) {
            args.variable.forEach(function (s) {
                // CB-9171
                var eq = s.indexOf('=');
                if (eq == -1)
                    throw new WeexpackError("invalid variable format: " + s);
                var key = s.substr(0, eq).toUpperCase();
                var val = s.substr(eq + 1, s.length);
                cli_vars[key] = val;
            });
        }
        var download_opts = { searchpath : args.searchpath
                            , noregistry : args.noregistry
                            , nohooks : args.nohooks
                            , cli_variables : cli_vars
                            , browserify: args.browserify || false
                            , fetch: args.fetch || false
                            , link: args.link || false
                            , save: args.save || false
                            , shrinkwrap: args.shrinkwrap || false
                            , force: args.force || false
                            , ali: args.ali || false
                            };

        return cordova.raw[cmd](subcommand, targets, download_opts);
    }

    function create() {
        var cfg;            // Create config
        var customWww;      // Template path
        var wwwCfg;         // Template config

        // If we got a fourth parameter, consider it to be JSON to init the config.
        if (undashed[4])
            cfg = JSON.parse(undashed[4]);
        else
            cfg = {};

        customWww = args['copy-from'] || args['link-to'] || args.template;

        if (customWww) {
            if (!args.template && !args['copy-from'] && customWww.indexOf('http') === 0) {
                throw new CordovaError(
                    'Only local paths for custom www assets are supported for linking' + customWww
                );
            }

            // Resolve tilda
            if (customWww.substr(0,1) === '~')
                customWww = path.join(process.env.HOME,  customWww.substr(1));

            wwwCfg = {
                url: customWww,
                template: false,
                link: false
            };

            if (args['link-to']) {
                wwwCfg.link = true;
            }
            if (args.template) {
                wwwCfg.template = true;
            } else if (args['copy-from']) {
                logger.warn('Warning: --copy-from option is being deprecated. Consider using --template instead.');
                wwwCfg.template = true;
            }

            cfg.lib = cfg.lib || {};
            cfg.lib.www = wwwCfg;
        }

        return cordova.raw.create( undashed[1]  // dir to create the project in
            , undashed[2]  // App id
            , undashed[3]  // App name
            , cfg
            , events || undefined
        );
    }
}





