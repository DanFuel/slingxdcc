/*
* ----------------------------------------------------------------------------
* "THE BEER-WARE LICENSE" (Revision 42):
* <varga.daniel@gmx.de> wrote this file. As long as you retain this notice you
* can do whatever you want with this stuff. If we meet some day, and you think
* this stuff is worth it, you can buy me a beer in return Daniel Varga
* ----------------------------------------------------------------------------
*/
var xdcclogger = function xdcclogger(){
    //defining a var instead of this (works for variable & function) will create a private definition
    var dirty = require("dirty"),
        query = require("dirty-query").query,
        irc = require("irc");

    var serverDb = dirty.Dirty("config/server.db");
    var packDb = dirty.Dirty("packets.db");

    var serverkeys = [];
    var ircServers = {};

    var packRegex = /#(\d+)\s+(\d+)x\s+\[\s*([><]?[0-9\.]+[TGMKtgmk]?)\]\s+(.*)/;

    init();

    this.addServer = function(srvkey, options){
        //if connection already exists remove it
        if(typeof ircServers[srvkey] !== "undefined"){
            this.removeServer(srvkey);
        }
        //create new irc Client
        var iclient = new irc.Client(options.host, options.nick, {
            userName: options.nick,
            realName: options.nick,
            port: options.port,
            debug: false,
            stripColors: true
        });
        //register error Handler
        iclient.on("error",function(message){
            if(typeof ircServers[srvkey].error === "undefined"){
                ircServers[srvkey].error = [];
            }
            ircServers[srvkey].error.push(message);
        });
        iclient.once("registered", function(){
            if(typeof ircServers[srvkey] !== "undefined"){
                removeServer(srvkey);
            }
            ircServers[srvkey] = iclient;
            //remember serverkey
            serverkeys.push(srvkey);
            serverkeys = uniqueArray(serverkeys);
            //make persistent
            serverDb.set(srvkey,{
                host: options.host,
                port: options.port,
                nick: options.nick,
                channels: [],
                observchannels: []
            });
        });
    };

    this.removeServer = function(srvkey){
        //if connection exists
        if(typeof ircServers[srvkey] !== "undefined"){
            //disconnect & remove all listeners
            ircServers[srvkey].disconnect();
            ircServers[srvkey].removeAllListeners();
            delete ircServers[srvkey];
            //remove it from db
            serverkeys = removeArrayItem(serverkeys,srvkey);
            serverDb.rm(srvkey);
        }
    };

    this.joinChannels = function(srvkey, channels){
        //if connection exists
        if(typeof ircServers[srvkey] !== "undefined"){
            //get the old settings from db
            var tmpServer = serverDb.get(srvkey);
            channels.forEach(function(channel, i){
                channel = channel.toLowerCase();
                //join the channel
                ircServers[srvkey].join(channel);
                //modify the channels array
                tmpServer.channels.push(channel);
            });
            tmpServer.channels = uniqueArray(tmpServer.channels);
            //make persistent
            serverDb.set(srvkey, tmpServer);
        }
    };

    this.partChannels = function(srvkey, channels){
        //if connection exists
        if(typeof ircServers[srvkey] !== "undefined"){
            //get the old settings from db
            var tmpServer = serverDb.get(srvkey);
            channels.forEach(function(channel, i){
                channel = channel.toLowerCase();
                //part the channel
                ircServers[srvkey].part(channel);
                //modify the channels array
                tmpServer.channels = removeArrayItem(tmpServer.channels,channel);
            });
            tmpServer.channels = uniqueArray(tmpServer.channels);
            //make persistent
            serverDb.set(srvkey, tmpServer);
        }
    };

    this.observChannels = function(srvkey, channels){
        //if connection exists
        if(typeof ircServers[srvkey] !== "undefined"){
            //get the old settings from db
            var tmpServer = serverDb.get(srvkey);
            channels.forEach(function(channel, i){
                channel = channel.toLowerCase();
                //register listener
                ircServers[srvkey].on("message"+channel, function(nick, text, message){
                    logPack(nick, text, srvkey);
                });
                //modify the channels array
                tmpServer.observchannels.push(channel);
            });
            tmpServer.observchannels = uniqueArray(tmpServer.observchannels);
            //make persistent
            serverDb.set(srvkey, tmpServer);
        }
    };

    this.unobservChannels = function(srvkey, channels){
        //if connection exists
        if(typeof ircServers[srvkey] !== "undefined"){
            //get the old settings from db
            var tmpServer = serverDb.get(srvkey);
            channels.forEach(function(channel, i){
                channel = channel.toLowerCase();
                //unregister listener
                ircServers[srvkey].removeAllListeners("message"+channel);
                //modify the channels array
                tmpServer.observchannels = removeArrayItem(tmpServer.observchannels,channel);
            });
            tmpServer.observchannels = uniqueArray(tmpServer.observchannels);
            //make persistent
            serverDb.set(srvkey, tmpServer);
        }
    };

    this.getIrcServers = function(){
        var servers = {}
        serverDb.forEach(function(key, val){
            servers[key] = val;
            servers[key].error = []
            servers[key].connected = false;
            if(typeof ircServers[key] !== "undefined" && typeof ircServers[key].error !== "undefined"){
                servers[key].error = ircServers[key].error;
            }
            if(serverkeys.indexOf(key) != -1){
                servers[key].connected = true;
            }

        });
        return servers;
    };

    this.numberOfPackets = function(){
        return packDb.size();
    };

    this.connectedPackets= function(){
        return query(packDb,{server: { $in: serverkeys}},{cache: false}).length;
    };

    this.getPacket = function(key){
        return packDb.get(key);
    };

    this.searchPackets = function(string, sortBy, sortOrder, filterDiscon){
        var q = queryBuilder(null, null, sortBy, sortOrder, string, filterDiscon, null);
        return query(packDb, q.query, q.options);
    };

    this.searchPacketsPaged = function(string, limit, page, sortBy, sortOrder, filterDiscon, cb){
        if(parseInt(page) == 1) query(packDb,"reset_cache");

        var q = queryBuilder(limit, page, sortBy, sortOrder, string, filterDiscon, cb);

        query(packDb, q.query, q.options);
        return;
    };

    function queryBuilder(limit, page, sortBy, sortOrder, search, filterDiscon, cb){
        var buildquery = {
            query:{},
            options:{}
        };

        if(limit !== null){
            buildquery.options =  {
                sortBy: sortBy,
                order: sortOrder,
                limit: limit,
                page: page,
                cache: true,
                pager: cb
            };
        }else{
            buildquery.options =  {
                sortBy: sortBy,
                order: sortOrder,
            };
        }


        if(typeof search !== 'string'){
            buildquery.query = {nr: {$has: true}};
        }else{
            var words = search.toLowerCase().split(" ");
            buildquery.query.filename = {
                $cb: function(attr){
                    attr = attr.toLowerCase();
                    for(var i in words){
                        if(attr.indexOf(words[i]) < 0){
                            return false;
                        }
                    }return true;
                }
            };
        }

        if (filterDiscon === true){
            buildquery.query.server = {
                $in: serverkeys
            };
        }

        return buildquery;

    }

    function logPack(nick, text, srvkey){

        if(text.charAt(0) != '#') return;
        var packinfo = text.match(packRegex);
        if (packinfo !== null) {
            packDb.set(srvkey+'#'+nick+'#'+packinfo[1],
                   {server:srvkey,
                    nick:nick,
                    nr:packinfo[1],
                    downloads:packinfo[2],
                    filesize:packinfo[3],
                    filename:packinfo[4],
                    lastseen:new Date().getTime()}
            );
        }
    }

    function init(){
        serverDb.on("load", function() {
            serverDb.forEach(function(srvkey, val) {
                if(typeof val !== "undefined"){
                    var ircClient = new irc.Client(val.host, val.nick, {
                        userName: val.nick,
                        realName: val.nick,
                        port: val.port,
                        debug: false,
                        stripColors: true
                    });
                    ircClient.on("error",function(message){
                        if(typeof ircServers[srvkey].error === "undefined"){
                            ircServers[srvkey].error = [];
                        }
                        ircServers[srvkey].error.push(message);
                    });
                    ircClient.once("registered", function(){
                        ircServers[srvkey] = ircClient;
                        serverkeys.push(srvkey);
                        if(typeof val.channels !== "undefined"){
                            val.channels.forEach(function(channel, i){
                                ircServers[srvkey].join(channel);
                            });
                        }
                        if(typeof val.observchannels !== "undefined"){
                            val.observchannels.forEach(function(channel, i){
                                ircServers[srvkey].on("message"+channel, function(nick, text, message){
                                    logPack(nick, text, srvkey);
                                });
                            });
                        }
                    });
                }
            });
        });
    }

    function uniqueArray(array){
        var u = {}, a = [];
        for(var i = 0, l = array.length; i < l; ++i){
            if(u.hasOwnProperty(array[i])) {
                continue;
            }
            a.push(array[i]);
            u[array[i]] = 1;
        }
        return a;
    }

    function removeArrayItem(array, item){
        var id = array.indexOf(item);
        if(id != -1) array.splice(id, 1);
        return array;
    }

    if(xdcclogger.caller != xdcclogger.getInstance){
        throw new Error("This object cannot be instantiated");
    }
};

/* ************************************************************************
 SINGLETON CLASS DEFINITION
 ************************************************************************ */
xdcclogger.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
xdcclogger.getInstance = function(){
    if(this.instance === null){
        this.instance = new xdcclogger();
    }
    return this.instance;
};

module.exports = xdcclogger.getInstance();
