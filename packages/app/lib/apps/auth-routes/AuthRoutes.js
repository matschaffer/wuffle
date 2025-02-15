const { URLSearchParams } = require('url');

const fetch = require('node-fetch');

const {
  withSession
} = require('../../middleware');

const {
  randomString
} = require('../../util');


/**
 * This component implements login, logout and login_check routes for
 * the front-end.
 *
 * Under the hood, it uses GitHub's APIs to perform user authentication
 * via OAuth.
 *
 * @param {Logger} app
 * @param {Router} router
 * @param {SecurityContext} securityContext
 */
function AuthRoutes(logger, router, securityContext) {

  const middlewares = [
    withSession
  ];

  const log = logger.child({
    name: 'wuffle:auth-flow'
  });

  /**
   * Trigger login via GitHub OAuth flow.
   */
  router.get('/wuffle/login', ...middlewares, (req, res) => {

    const state = randomString();

    const redirectTo = safeGetReferer(req, '/board');

    req.session.loginFlow = {
      t: Date.now(),
      redirectTo,
      state
    };

    const params = new URLSearchParams();
    params.append('client_id', process.env.GITHUB_CLIENT_ID);
    params.append('state', state);
    params.append('redirect_uri', appUrl('/wuffle/login/callback'));

    return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });


  /**
   * Trigger login via GitHub OAuth flow.
   */
  router.get('/wuffle/logout', ...middlewares, (req, res) => {

    const redirectTo = safeGetReferer(req, '/board');

    return req.session.destroy(function(err) {
      return res.redirect(redirectTo);
    });

  });


  /**
   * Handle login callback received from GitHub OAuth flow.
   */
  router.get('/wuffle/login/callback', ...middlewares, async (req, res) => {

    const {
      state,
      code
    } = req.query;

    const {
      loginFlow,
      id: session_id
    } = req.session;

    const logContext = {
      session_id
    };

    if (!loginFlow) {
      log.warn(logContext, 'no active login flow');

      return res.redirect(safeGetReferer(req, '/'));
    }

    delete req.session.loginFlow;

    if (state !== loginFlow.state) {
      log.warn(logContext, 'state missmatch, aborting');

      return res.redirect(loginFlow.redirectTo);
    }

    const params = new URLSearchParams();
    params.append('code', code);
    params.append('state', state);
    params.append('client_id', process.env.GITHUB_CLIENT_ID);
    params.append('client_secret', process.env.GITHUB_CLIENT_SECRET);
    params.append('redirect_uri', appUrl('/wuffle/login/callback'));

    const {
      access_token
    } = await fetch('https://github.com/login/oauth/access_token', {
      headers: {
        'Accept': 'application/json'
      },
      method: 'POST',
      body: params
    }).then(res => {

      if (res.status >= 400) {
        throw new Error('failed to retrieve access_token');
      }

      return res.text();
    }).then(text => JSON.parse(text));

    const {
      login,
      avatar_url
    } = await securityContext.getAuthenticatedUser(access_token);

    req.session.githubUser = {
      access_token,
      avatar_url,
      login
    };

    log.info({
      login,
      t: Date.now() - loginFlow.t
    }, 'login successful');

    res.redirect(loginFlow.redirectTo);
  });


  /**
   * Retrieve logged in user information.
   */
  router.get('/wuffle/login_check', ...middlewares, async (req, res) => {

    const {
      session
    } = req;

    const {
      githubUser
    } = session;

    if (!githubUser) {
      return res.type('json').json(null);
    }

    const {
      login,
      avatar_url
    } = githubUser;

    // TODO(nikku): check if GitHub access is still granted via SecuritiyContext#getAuthenticatedUser
    return res.type('json').json({
      login,
      avatar_url
    });

  });


  // api ///////////////////////

  this.getGitHubUser = function(req) {
    return req.session && req.session.githubUser;
  };

}


module.exports = AuthRoutes;


// helpers ///////////////////////

function getBaseUrl() {
  return process.env.BASE_URL || 'http://localhost:3000';
}

function relativeUrl(baseUrl, location) {
  return `${baseUrl}${location}`;
}

function appUrl(location) {
  return relativeUrl(getBaseUrl(), location);
}

function isChildUrl(url, base) {
  return url.startsWith(base);
}

function safeGetReferer(req, fallbackUrl) {
  const referer = req.get('referer');

  const base = getBaseUrl();

  if (referer) {
    if (
      isChildUrl(referer, base)
    ) {
      return referer;
    }
  }

  return relativeUrl(base, fallbackUrl);
}