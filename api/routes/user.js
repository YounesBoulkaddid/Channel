var express = require('express');
var router = express.Router();
var jwt = require('jsonwebtoken');
var User = require('../models/user');
var config = require('../config/config');
var request = require('request');
var jwtAuth = require('express-jwt');
var channelModule = require('../modules/channel/channel');
var color = require('colors')

router.post('/subscribe', function(req, res, next) {

  if (!req.body.user.firstName || !req.body.user.lastName || !req.body.password || !req.body.user.email) {
      console.log('err');
      res.json({
            success: false,
            msg: 'Please pass name, email and password.'
        });
  } else {
    var newUser = new User({
        pseudo: req.body.user.pseudo,
        email: req.body.user.email,
        firstName: req.body.user.firstName,
        lastName: req.body.user.lastName,
        phone: req.body.user.phone,
        password: req.body.password
    });

    newUser.save(function(err) {
      if (err) {
            console.log(err);
            return res.send({
                success: false,
                msg: 'Username already exists.'
            });
      }
        User.findOne({
            email: req.body.user.email
        }, function(err, user) {
            if (err) throw err;

            if (!user) {
                res.send({
                    success: false,
                    msg: 'Authentication failed. User not found.'
                });
            } else {
                var token = jwt.sign({id : user._id.toString()}, config.secret, { expiresIn:  60*60*24 });
                delete user.password;
                res.send({
                    success: true,
                    msg: 'Successful created new user.',
                    auth_token: token,
                    user: user
                });

            }
        })

    });
  }

});

router.post('/login', function(req, res, next) {

    if (!req.body.password|| !req.body.email) {
        console.log('err');
        res.json({
            success: false,
            msg: 'Please pass email and password.'
        });
    }else{
        var param = req.body.email;

        User.findOne({
            $or:[ {email:{ $regex : new RegExp(param, "i") }}, {'phone':param} ]
        }, function(err, user) {
            if (err) throw err;

            if (!user) {
                res.send({
                    success: false,
                    msg: 'Authentication failed. User not found.'
                });
            } else {

                user.comparePassword(req.body.password, function (err, isMatch) {
                    if (isMatch && !err) {

                        var token = jwt.sign({id : user._id.toString()}, config.secret, { expiresIn:  60*60*24 });

                        res.json({
                            success: true,
                            msg: "Successful authenfication",
                            auth_token: token,
                            user: user
                        });
                    } else {
                        res.send({
                            success: false,
                            msg: 'Authentication failed. Wrong password.'
                        });
                    }
                });
            }
        });
    }


});


router.post('/oauth', jwtAuth({ secret: config.secret}), function(req, res) {

    if (!req.body.code|| !req.body._id) {
        console.log(err);
        res.json({
            success: false,
            msg: 'Please pass code and id.'
        });
    }
    else{

        var url = 'https://accounts.google.com/o/oauth2/token';
        var payload = {
            grant_type: 'authorization_code',
            code: req.body.code,
            client_id: config.client_id,
            client_secret: config.client_secret,
            redirect_uri: config.redirect_uri
        };


        request.post(url, { form: payload }, function(error, response, body) {
            body = JSON.parse(body)
            if(!body.token_type){
                console.log(body);
                res.json({
                    success: false,
                    msg: 'Bad oAuth Authentification'
                });
            }else{
                var options = {
                    url: 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
                    headers: {
                        'Authorization': 'Bearer '+body.access_token
                    }
                };
                request.get(options, function(error, response, youtubeBody) {
                     youtubeBody = JSON.parse(youtubeBody);

                    getSubscription(body.access_token, function(subscription){
                        channelModule.saveYoutubeChannels(subscription, function(data){
                            User.findOne({
                            _id : req.body._id,

                            }, function(err, user) {
                                    if(err) throw err;
                                var channels = user.channels.toObject();
                                for(var n in data){
                                    for(var i in channels){
                                        if(channels[i].id && data[n].id == channels[i].id){
                                            data[n] = channels[i]
                                        }
                                    }
                                }
                                user.channels = data;

                         
                                user.services.push({
                                    serviceName: 'youtube',
                                    profile: {
                                        id: youtubeBody.items[0].id,
                                        title: youtubeBody.items[0].snippet.title,
                                        description: youtubeBody.items[0].snippet.description,
                                        thumbnails: youtubeBody.items[0].snippet.thumbnails
                                    },
                                    token: {
                                        token: body.access_token,
                                        refreshToken: body.refresh_token,
                                        token_type: body.token_type,
                                        expires_in: body.expires_in
                                    }
                                });

                                user.save(function (err) {
                                    res.json({
                                        success: true,
                                        msg: "Successful authenfication",
                                        user: user
                                    });


                                })

                                }
                            );
                        });
                    });
                })
            }
        });
    }
});


function getSubscription(access_token, callback){
    var header = {
        'Authorization': 'Bearer '+access_token
    }
    var options = {
        url: 'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&maxResult=50&mine=true',
        headers: header
    };

    request.get(options, function(error, response, subscriptionBody) {
        var subscriptionBody = JSON.parse(subscriptionBody);
        var items = [];
        for(var key in subscriptionBody.items){

            console.log(color.cyan(subscriptionBody.items[key]))
            items.push({
                channelId: subscriptionBody.items[key].snippet.resourceId.channelId,
                title: subscriptionBody.items[key].snippet.title,
                description: subscriptionBody.items[key].snippet.description,
                categories: [],
                thumbnails: {
                    "default": subscriptionBody.items[key].snippet.thumbnails.default.url,
                    medium: subscriptionBody.items[key].snippet.thumbnails.medium.url,
                    high: subscriptionBody.items[key].snippet.thumbnails.high.url
                }
            })
        }

        getNext(items, subscriptionBody.nextPageToken)


    });

    function getNext(items, nextPageToken){
        console.log(nextPageToken);
        var options = {
            url: 'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50&pageToken='+nextPageToken,
            headers: header
        };

        request.get(options, function(error, response, subscriptionBody) {
            var subscriptionBody = JSON.parse(subscriptionBody);

            for (var key in subscriptionBody.items) {
                items.push({
                    channelId: subscriptionBody.items[key].snippet.resourceId.channelId,
                    title: subscriptionBody.items[key].snippet.title,
                    description: subscriptionBody.items[key].snippet.description,
                    categories: [],
                    thumbnails: {
                        "default": subscriptionBody.items[key].snippet.thumbnails.default.url,
                        medium: subscriptionBody.items[key].snippet.thumbnails.medium.url,
                        high: subscriptionBody.items[key].snippet.thumbnails.high.url
                    }
                })
            }

            if(subscriptionBody.nextPageToken){
                getNext(items, subscriptionBody.nextPageToken)
            }else{
                callback(items);
            }
        })
    }

}

module.exports = router;
