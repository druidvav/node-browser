"use strict";
let Curl = require('node-libcurl').Curl;
let CurlIpResolve = require('node-libcurl').CurlIpResolve;
let Cookie = require('tough-cookie').Cookie;
let CookieJar = require('tough-cookie').CookieJar;

let DvBrowser = function (_config) {
    const config = Object.assign({}, {
        timeout: 15,
        connectTimeout: 5,
        httpProxy: null,
        allowRedirect: true,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.122 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        acceptLanguage: 'ru,en-US,en;q=0.8,ru;q=0.6',
        cacheControl: 'max-age=0',
        connection: 'close',
        proxyConnection: 'close',
        xhr: false,
        origin: null,
        authBasic: null,
        authBearer: null,
        noDeflate: false,
        lowSpeedTimeout: 15,
    }, _config);

    const cookiejar = new CookieJar(null);

    this.setCookie = function (cookie, url, options) { cookiejar.setCookieSync(cookie, url, options); };
    this.getCookie = function (key, url) {
        let cookies = cookiejar.getCookiesSync(url);
        for (let cookie of cookies) {
            if (cookie.key === key) {
                return cookie.value;
            }
        }
        return null;
    };

    this.get = function (url, options) {
        if (!options) options = { };
        options.url = url;
        return processRequest('GET', options);
    };
    this.post = function (url, postData, options) {
        if (!options) options = { };
        options.url = url;
        options.postData = postData;
        return processRequest('POST', options);
    };
    this.json = function (url, postData, options) {
        if (!options) options = { };
        options.url = url;
        options.postData = postData;
        options.contentType = 'application/json';
        return processRequest('POST', options);
    };
    this.request = function (method, options) { return processRequest(method, options); };

    function processRequest(method, _options) {
        return new Promise((resolve, reject) => {
            const options = Object.assign({}, config, _options);

            let responseHeaders = [ ];
            let responseStatus = 0;
            let responseBody = [ ];
            let callbackCalled = false;

            let headers = [ ];
            let cookieString = cookiejar.getCookieStringSync(options.url);
            if (cookieString) {
                headers.push('Cookie: ' + cookieString);
            }
            if (!options.contentType && options.postData) {
                options.contentType = 'application/x-www-form-urlencoded';
            }
            if (options.contentType) {
                headers.push('Content-Type: ' + options.contentType);
            }
            headers.push('Connection: ' + options['connection']);
            headers.push('Accept: ' + options['accept']);
            headers.push('Accept-Language: ' + options['acceptLanguage']);
            headers.push('User-Agent: ' + options['userAgent']);
            headers.push('Cache-Control: ' + options['cacheControl']);
            headers.push('Proxy-Connection: ' + options['proxyConnection']);
            if (options.referer) {
                headers.push('Referer: ' + options.referer);
            }
            if (!options.noDeflate) {
                headers.push('Accept-Encoding: gzip, deflate');
            }
            if (options.xhr) {
                headers.push('X-Requested-With: XMLHttpRequest');
            }
            if (options.origin) {
                headers.push('Origin: ' + options.origin);
            }
            if (options.authBasic) {
                headers.push('Authorization: Basic ' + (new Buffer(options.authBasic)).toString('base64'));
            }
            if (options.authBearer) {
                headers.push('Authorization: Bearer ' + options.authBearer);
            }
            if (options['headers']) {
                for (let i = 0; i < options['headers'].length; i++) {
                    headers.push(options['headers'][i]);
                }
            }
            headers.push('Expect: ');

            let startTime = new Date().getTime();
            let timeoutControl = setInterval(() => {
                let curTime = new Date().getTime();
                let execTime = Math.round((curTime - startTime) / 1000);
                if (execTime > (options.timeout + options.connectTimeout) * 2) {
                    console.log('timeout', options.url, curTime - startTime, options);
                    throw new DvBrowserError('Something went wrong and timeout expired');
                }
            }, 500);
            let curl = new Curl();
            curl.setOpt(Curl.option.URL, options.url);
            curl.setOpt(Curl.option.TIMEOUT, options.timeout);
            curl.setOpt(Curl.option.CONNECTTIMEOUT, options.connectTimeout);
            if (options.lowSpeedTimeout) {
                curl.setOpt(Curl.option.LOW_SPEED_TIME, options.lowSpeedTimeout);
                curl.setOpt(Curl.option.LOW_SPEED_LIMIT, 512);
            }
            curl.setOpt(Curl.option.NOPROGRESS, true);
            curl.setOpt(Curl.option.HTTPHEADER, headers);
            // curl.setOpt(Curl.option.VERBOSE, true);
            curl.setOpt(Curl.option.IPRESOLVE, CurlIpResolve.V4);
            if (method === 'POST') {
                curl.setOpt(Curl.option.POST, true);
                curl.setOpt(Curl.option.POSTFIELDS, options.postData);
            }
            curl.setOpt(Curl.option.FOLLOWLOCATION, options.allowRedirect);
            curl.setOpt(Curl.option.SSL_VERIFYHOST, false);
            curl.setOpt(Curl.option.SSL_VERIFYPEER, false);
            if (!options.noDeflate) {
                curl.setOpt(Curl.option.ACCEPT_ENCODING, 'gzip');
            }
            if (options?.httpProxy?.address && options?.httpProxy?.port) {
                curl.setOpt(Curl.option.PROXY, options.httpProxy.address + ':' + options.httpProxy.port);
                if (options.httpProxy.auth) {
                    curl.setOpt(Curl.option.PROXYUSERPWD, options.httpProxy.auth);
                }
            }
            curl.on('header', handleHeader);
            curl.on('error', handleError);
            curl.on('data', handleBody);
            curl.on('end', handleFinish);
            curl.perform();

            function handleError(error) {
                finishError(error.message);
            }

            function handleHeader(chunk) {
                let header = chunk.toString().replace("\r", '').replace("\n", '');
                if (chunk.length > 2) {
                    if (header.substring(0, 4) === 'HTTP') {
                        let status = header.split(' ');
                        responseStatus = status[1];
                    } else {
                        responseHeaders.push(header);
                    }
                }
                return chunk.length;
            }

            function handleBody(chunk) {
                responseBody.push(chunk);
                return chunk.length;
            }

            function handleFinish() {
                let result = {
                    status: parseInt(responseStatus), // curl.getInfo('RESPONSE_CODE'),
                    contentType: curl.getInfo('CONTENT_TYPE'),
                    headers: responseHeaders,
                    body: Buffer.concat(responseBody),
                    proxy: config.httpProxy
                };
                for (let i in responseHeaders) {
                    if (!responseHeaders.hasOwnProperty(i)) continue;
                    let header = responseHeaders[i];
                    if (/Set-Cookie:/i.test(header)) {
                        let cookie = Cookie.parse(header.replace(/Set-Cookie:/i, '').replace('qwintry.loc', 'qwintry.com').trim());
                        if (cookie) {
                            cookiejar.setCookieSync(cookie, options.url, { ignoreError: true });
                        }
                    }
                }
                finishSuccess(result);
            }

            function finishSuccess(result) {
                finish(null, result);
            }

            function finishError(error) {
                finish(new DvBrowserError(error, options.url, config.httpProxy ));
            }

            function finish(error, result) {
                clearInterval(timeoutControl);
                if (callbackCalled) {
                    throw new DvBrowserError('trying to send callback twice', options.url);
                }
                curl.close();
                callbackCalled = true;
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        });
    }
};

class DvBrowserError extends Error {
    constructor(message, url, proxy) {
        super(message);
        this.url = url;
        this.proxy = proxy;
        this.name = "DvBrowserError";
    }
    getUrl() {
        return this.url;
    }
    getProxy() {
        return this.proxy;
    }
}

module.exports = DvBrowser;