const express = require('express');
var url = require('url');
var fs = require('fs');
var qs = require('querystring');
var http = require('https');

const app = express();

const dexcomAppData = {
  client_id: process.env.DEXCOM_ID,
  client_secret: process.env.DEXCOM_SECRET,
  redirect_uri: 'https://garmin-dexcom-conection.andreto.repl.co/dexcom-login-response'
};

// --- Initialize Mongo ---
const MongoClient = require('mongodb').MongoClient;
const mongo_username = process.env.MONGO_USERNAME;
const mongo_password = process.env.MONGO_PASSWORD;
const mongo_database = process.env.MONGO_DATABASE;

const uri = `mongodb+srv://${mongo_username}:${mongo_password}@cluster0.tvvau.mongodb.net/${mongo_database}?retryWrites=true&w=majority`;

MongoClient.connect(uri, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true
}, (error, client) => {
  if (error) {
    return console.log('\x1b[31m%s\x1b[0m', 'Connection to database failed');
  }
  console.log('\x1b[32m%s\x1b[0m', 'Conected to database', mongo_database);
  const db = client.db(mongo_database);
  const auth_data = db.collection("auth-data");
  const cgm_data = db.collection("cgm-data");

  // --- Dexcom client data ---

  // --- MAIN PAGE ---
  app.get('/', (req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.write('<a href="/dexcom-login">dexcom-login</a>');
    res.write('<br><a href="/get-data">get-data</a>');
    res.end();
  });

  // --- GET DATA ----
  app.get('/get-data', (req, res) => {
    var q = url.parse(req.url, true).query;

    var time_now = new Date();
    var timestamp = time_now.getHours() + ":" + time_now.getMinutes() + ":" + time_now.getSeconds();

    console.log('\x1b[36m' + 'Request: /get-data' + '\x1b[2m', timestamp + '\x1b[0m', q.auth, )

    if (q.auth) {
      var time_Sch = new Date(time_now.getTime() + 4.5*60000);
      var sch_timestamp = time_Sch.getHours() + ":" + time_Sch.getMinutes() + ":" + time_Sch.getSeconds();
      console.log('\x1b[33m', 'Scheduled getEgvs ->', '\x1b[2m', sch_timestamp);
      setTimeout(function(){
        getEgvs(q.auth)
        var time_now = new Date();
        var timestamp = time_now.getHours() + ":" + time_now.getMinutes() + ":" + time_now.getSeconds();
        console.log('\x1b[33m', 'Completed scheduled getEgvs', '\x1b[2m', timestamp);
      }, 270 * 1000);
      cgm_data.findOne({session_token: q.auth}, function(err, result) {
        if (result) {
          delete result["_id"];
          delete result["session_token"];
          return res.json(result);
        } else {
          return res.json({error: "invalid token"});
        }
      });
    } else {
      res.end(JSON.stringify({error: "no token"}))
    }
  });

  // --- DEXCOM LOGIN ---
  app.get('/dexcom-login', (req, res) => {
    res.writeHead(302, {
      'Location': 'https://sandbox-api.dexcom.com/v2/oauth2/login?client_id=' + dexcomAppData.client_id + '&redirect_uri=' + dexcomAppData.redirect_uri + '&response_type=code&scope=offline_access'
    });
    res.end();
  });

  // --- RESPONSE FROM DEXCOM ---
  app.get('/dexcom-login-response', (req, res) => {
    var q = url.parse(req.url, true).query;

    if (q.error) {
      console.error('\x1b[31m%s\x1b[0m', '/dexcom-login-response error:', q.error);
      res.write('Login aborted: '+ q.error);

    } else if (q.code) {
      var authorization_code = q.code;
      var session_token = createToken(64);
      console.log('\x1b[33m%s\x1b[0m', 'Creating new session...');
      postAuthRequest('authorization_code', authorization_code, null, session_token);

      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(fs.readFileSync('dexcom-login-response.html'));
      res.write(session_token);
      res.write('";</script>');

    } else if (q.testing) {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(fs.readFileSync('dexcom-login-response.html'));
      res.write('token goes here";</script>');

    } else {
      console.error('\x1b[31m%s\x1b[0m', '/dexcom-login-response error:', 'unknown error');
      res.write('Login aborted: unknown error');
    }
    res.end();
  });

  app.listen(3000, () => {
    console.log('\x1b[34m%s\x1b[0m','SERVER STARTED');
  });

  // --- CREATE TOKEN ---
  function createToken(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  // --- MAKE REQUEST ---
  function makeRequest(req_data, options, session_token, endFunction) {
    var token_req = http.request(options, function (token_res) {
      var chunks = [];

      token_res.on("data", function (chunk) {
        chunks.push(chunk);
      });

      token_res.on("end", function () {
        var body = Buffer.concat(chunks);
        endFunction(body.toString());
      });
    });

    token_req.on('error', error => {
      console.error(error);
    });

    token_req.write(req_data);
    token_req.end();
  }

  // --- POST AUTH REQUEST ---
  function postAuthRequest(grant_type, authorization_code, refresh_token, session_token){
    var req_data = qs.stringify({ 
      'client_secret': dexcomAppData.client_secret,
      'client_id': dexcomAppData.client_id,
      'code': authorization_code,
      'refresh_token': refresh_token,
      'grant_type': grant_type,
      'redirect_uri': dexcomAppData.redirect_uri 
    });
    var req_options = {
      "method": "POST",
      "hostname": "sandbox-api.dexcom.com",
      "port": null,
      "path": "/v2/oauth2/token",
      "headers": {
        "content-type": "application/x-www-form-urlencoded",
        "cache-control": "no-cache"
      }
    };
    if (authorization_code) {
      makeRequest(req_data, req_options, session_token, function(chunk_data) {
        var mongo_data = JSON.parse(chunk_data);
        mongo_data.session_token = session_token;
        auth_data.insertOne(mongo_data, function(err, res) {
          if (err) throw err;
          console.log('\x1b[32m%s\x1b[0m', 'Sucsessfully inserted new auth');
        });
        var cgm_blank = {
          "session_token": session_token,
          "timestamp": null,
          "value": null,
          "trend_rate": null,
          "trend": null
        };
        cgm_data.insertOne({"session_token": session_token}, function(err, res) {
          if (err) throw err;
          console.log('\x1b[32m%s\x1b[0m', 'Sucsessfully inserted blank cgm');
        });
      });
    } else if (refresh_token) {
      makeRequest(req_data, req_options, session_token, function(chunk_data) {
        var m_data = JSON.parse(chunk_data);
        m_data.session_token = session_token;
        var m_query = {"session_token": session_token};
        console.log(chunk_data, session_token);
        auth_data.updateOne(m_query, {$set:m_data}, function(err, res) {
          if (err) throw err;
          console.log('\x1b[32m%s\x1b[0m', 'Sucsessfully refreshed auth');
        });
      });
    } else {
      console.log('\x1b[31m%s\x1b[0m', 'invalid postAuthRequest');
    }
  }

  // --- GET USER GLUCOSE DATA ---
  function getEgvs(session_token) {

    var currentDate = new Date();
    var endDate = new Date(currentDate.getTime() - 1000*60*60*24*30);
    var startDate = new Date(endDate.getTime() - 10*60000);
    startDate = startDate.toISOString().split(".")[0];
    endDate = endDate.toISOString().split(".")[0];

    console.log('\x1b[33m%s\x1b[0m', 'Geting egvs data...');


    var req_options = {
      "method": "GET",
      "hostname": "sandbox-api.dexcom.com",
      "port": null,
      "path": "/v2/users/self/egvs?startDate=" + startDate + "&endDate=" + endDate,
      "headers": {
        "authorization": "Bearer "
      }
    };
    console.log(session_token);
    auth_data.findOne({"session_token": session_token}, function(err, result) {
      if (err) throw err;
      if(result.access_token) {
        req_options.headers.authorization = "Bearer " + result.access_token;
        makeRequest("", req_options, session_token, function(chunk_data) {
          processEgvsData(chunk_data, session_token);
        });
        console.log('\x1b[32m%s\x1b[0m', 'GET egvs sent');
      } else {
        console.log('\x1b[31m%s\x1b[0m', 'GET egvs -> invalid token');
      }
    });
  }

  var trendDef ={
    'flat': 0,
    'fortyFiveUp': 1,
    'fortyFiveDown': 2,
    'singleUp': 3,
    'singleDown': 4,
    'doubleUp': 5,
    'doubleDown': 6,
    'notComputable': 7
  };

  // --- PROCESS USER GLUCOSE DATA ---
  function processEgvsData(data, session_token) {
    var outputData = {};
    data = JSON.parse(data);
    try {
      var egvs = data.egvs[0];

      console.log(egvs);

      outputData.session_token = session_token;
      outputData.timestamp = egvs.systemTime;
      outputData.value = (egvs.value * 0.0555).toFixed(1);
      outputData.trend_rate = (egvs.trendRate * 0.0555).toFixed(3);
      outputData.trend = trendDef[egvs.trend];

      var m_query = {"session_token": session_token};
      cgm_data.updateOne(m_query, { $set: outputData}, function(err, result) {
        if (err) throw err;
        console.log('\x1b[32m%s\x1b[0m', 'Sucsessfully updated cgm');
      });


    } catch (error) {
      if (data.fault) {
        console.log('\x1b[31m%s\x1b[0m', 'prosessing egvs data failed');
        if (data.fault.faultString == 'Invalid Access Token') {
          console.log('\x1b[33m%s\x1b[0m', 'Refreshing token...');
          auth_data.findOne(m_query, function(err, result ){
            postAuthRequest('refresh_token', null, result.refresh_token, session_token);
          })
        }
      } else {
        console.info(data);
        console.error(error);
      }
    }
  }
});