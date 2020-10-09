const stravaApi = require('strava-v3');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const decodePolyline = require('decode-google-map-polyline');

/**
 * Application configuration, all values set via environment variables.
 */
const config = {
    port: process.env.PORT, // Heroku sets this
    strava: {
	   access_token: process.env.STRAVA_ACCESS_TOKEN,
	   client_id: process.env.STRAVA_CLIENT_ID,
	   client_secret: process.env.STRAVA_CLIENT_SECRET,
	   redirect_uri: process.env.STRAVA_REDIRECT_URI,
    },
    authentication_token_secret: process.env.APP_AUTHENTICATION_TOKEN_SECRET,
};

/**
 * Algorithm used to construct JWT authentication tokens.
 */
const AUTH_ALGORITHM ='HS256';

/**
 * Name of cookie in which authentication tokens are stored.
 */
const AUTH_COOKIE = 'authenticationToken';

// Check that the configured Strava OAuth redirect endpoint matches with the
// endpoint we will define in our express API, I make this mistake all the
// time so I'm gonna catch it this time...
const STRAVA_OAUTH_REDIRECT_ENDPOINT = '/api/v0/auth/strava/oauth_callback';
if (config.strava.redirect_uri.indexOf(STRAVA_OAUTH_REDIRECT_ENDPOINT) === -1) {
    throw "The configured Strava OAuth redirect URI and this app's API endpoint do not match, this will cause problems and you must fix it";
}

// Configure express app
const app = express();
app.use(cookieParser());
app.use(express.static('public'));

/**
 * Middleware which ensures a valid JWT authentication token exists then sets
 * req.authToken to the decoded value. Additionally creates a Strava client for
 * that user in req.userStrava.
 */
const verifyAuthToken = async (req, res, next) => {
    // Check authentication cookie exists
    if (req.cookies[AUTH_COOKIE] === undefined) {
	   return res.status(401).json({
		  error: 'Not authorized',
	   });
    }

    // Verify JWT
    const authCookie = req.cookies[AUTH_COOKIE];
    try {
	   req.authToken = await jwt.verify(
		  authCookie, config.authentication_token_secret, {
			 algorithm: AUTH_ALGORITHM,
		  });
    } catch (e) {
	   console.error(`Failed to verify an authentication token JWT: ${e}`);
	   return res.status(401).json({
		  error: 'Not authorized',
	   });
    }

    req.userStrava = new stravaApi.client(req.authToken.payload.strava.authentication.access_token);

    next();
};

/**
 * Automatically redirects a user to the correct Strava OAuth step 1 URL.
 */
app.get('/api/v0/auth/strava/enter', (req, res) => {
    res.redirect(`http://www.strava.com/oauth/authorize?client_id=${config.strava.client_id}&response_type=code&redirect_uri=${config.strava.redirect_uri}&approval_prompt=force&scope=read,activity:read`);
});

/**
 * Users will be redirected to this endpoint when they complete the Strava
 * OAuth flow. We then store their Strava credentials in a cookie and redirect
 * them to the homepage.
 */
app.get(STRAVA_OAUTH_REDIRECT_ENDPOINT, async (req, res) => {
    // After the user agrees to give us access to their Strava account we should
    // have a request with a 'code' URL parameter. Exchange that with Strava on
    // our end and "we're in" ;)
    const stravaOAuthCode = req.query.code;

    let stravaTok = null

    try {
	   stravaTok = await stravaApi.oauth.getToken(stravaOAuthCode)
    } catch (e) {
	   console.error(`Failed to exchange a Strava OAuth code for a token: ${e}`);
	   return res.redirect('/?auth_error=strava');
    }

    // Figure out who this token belongs to, makes our life a lot easier later on.
    const userStrava = new stravaApi.client(stravaTok.access_token);
    
    let athlete = null;
    try {
	   athlete = await userStrava.athlete.get();
    } catch (e) {
	   console.error(`Failed to get information about authentication token owner: ${e}`);
	   return res.redirect('/?auth_error=strava');
    }

    // Send user a symmetrically encrypted JWT which contains their strava token,
    // we will use this in other endpoints to get their data.
    let token = null;
    
    try {
	   token = await jwt.sign({
		  payload: {
			 strava: {
				authentication: {
				    expires_at: stravaTok.expires_at,
				    refresh_token: stravaTok.refresh_token,
				    access_token: stravaTok.access_token,
				},
				athlete: athlete,
			 },
		  },
	   }, config.authentication_token_secret, {
		  algorithm: AUTH_ALGORITHM, 
	   });
    } catch (e) {
	   console.error(`Failed to construct JWT: ${e}`);
	   return res.redirect('/?auth_error=internal');
    }

    res.cookie(AUTH_COOKIE, token)

    return res.redirect('/');
});

app.get('/api/v0/strava/activities', verifyAuthToken, async (req, res) => {
    // Get activities
    let activities = null;
    
    try {
	   activities = await req.userStrava.athlete.listActivities({});
    } catch (e) {
	   console.error(`Failed to get Strava user activities: ${e}`);
	   return res.status(500).json({
		  error: 'Failed to get Strava user activities',
	   });
    }

    // Process polylines
    let actsResp = activities.map(act => {
	   return {
		  name: act.name,
		  type: act.type,
		  id: act.id,
		  start_date: act.start_date,
		  distance: act.distance,
		  moving_time: act.moving_time,
		  elapsed_time: act.elapsed_time,
		  start_location: act.start_latlng,
		  end_location: act.end_latlng,
		  polyline: act.map.summary_polyline,
		  path: decodePolyline(act.map.summary_polyline),
	   };
    });

    res.json({
	   activities: actsResp,
    });
});

// Start server
app.listen(config.port, () => {
    console.log(`Server listening on :${config.port}`);
});
