"use strict";
let Curl = require('node-libcurl').Curl;
let CurlIpResolve = require('node-libcurl').CurlIpResolve;
let Cookie = require('tough-cookie').Cookie;
let CookieJar = require('tough-cookie').CookieJar;

let DvBrowser = function () {
    let self = this;

    let globalHeaders = [
        'Accept-Language: ru,en-US,en;q=0.8,ru;q=0.6',
        'Connection: close',
        'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        'Cache-Control: max-age=0',
        'Proxy-Connection: close',
        'Expect: '  // remove "Expect: 100-continue" header
    ];

    let config = {
        timeout: 15,
        connectTimeout: 5,
        httpProxy: null,
        httpProxyUserPwd: null,
        allowRedirect: true
    };

    let cookiejar = new CookieJar();
    let referer = '';

    self.getProxy = function () { return config.httpProxy; };
    self.setProxy = function (host, creds) { config.httpProxy = host; config.httpProxyUserPwd = creds; };
    self.setReferer = function (url) { referer = url; };
    self.setCookie = function (cookie, url, options) { cookiejar.setCookieSync(cookie, url, options); };
    self.setTimeout = function (connect, read) { config.connectTimeout = connect; config.timeout = read; };
    self.setAllowRedirect = function (allowRedirect) { config.allowRedirect = allowRedirect };

    self.get = function (url) { return processRequest('GET', { url: url }); };
    self.post = function (url, postData) { return processRequest('POST', { url: url, postData: postData }); };
    self.postEx = function (options) { return processRequest('POST', options); };
    self.request = function (method, options) { return processRequest(method, options); };

    function processRequest(method, options) {
        return new Promise((resolve, reject) => {
            let responseHeaders = [ ];
            let responseStatus = 0;
            let responseBody = [ ];
            let callbackCalled = false;

            let headers = JSON.parse(JSON.stringify(globalHeaders)); // Cloning object
            let cookieString = cookiejar.getCookieStringSync(options.url);
            if (cookieString) {
                headers.push('Cookie: ' + cookieString);
            }
            if (referer) {
                headers.push('Referer: ' + referer);
            }
            if (options.contentType) {
                headers.push('Content-Type: ' + options.contentType);
            } else if (method === 'POST') {
                headers.push('Content-Type: application/x-www-form-urlencoded');
            }
            if (options.accept) {
                headers.push('Accept: ' + options.accept);
            } else {
                headers.push('Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
            }
            if (!options.noDeflate) {
                headers.push('Accept-Encoding: gzip, deflate');
            }
            if (options['headers']) {
                for (let i = 0; i < options['headers'].length; i++) {
                    headers.push(options['headers'][i]);
                }
            }

            let startTime = new Date().getTime();
            let timeoutControl = setInterval(() => {
                let curTime = new Date().getTime();
                let execTime = Math.round((curTime - startTime) / 1000);
                if (execTime > (config.timeout + config.connectTimeout) * 2) {
                    console.log('timeout', options.url, curTime - startTime, config);
                    throw new DvBrowserError('Something went wrong and timeout expired');
                }
            }, 500);
            let curl = new Curl();
            curl.setOpt(Curl.option.URL, options.url);
            curl.setOpt(Curl.option.TIMEOUT, config.timeout);
            curl.setOpt(Curl.option.CONNECTTIMEOUT, config.connectTimeout);
            curl.setOpt(Curl.option.LOW_SPEED_TIME, config.timeout);
            curl.setOpt(Curl.option.LOW_SPEED_LIMIT, 512);
            curl.setOpt(Curl.option.NOPROGRESS, true);
            curl.setOpt(Curl.option.HTTPHEADER, headers);
            // curl.setOpt(Curl.option.VERBOSE, true);
            curl.setOpt(Curl.option.IPRESOLVE, CurlIpResolve.V4);
            if (method === 'POST') {
                curl.setOpt(Curl.option.POST, true);
                curl.setOpt(Curl.option.POSTFIELDS, options.postData);
            }
            curl.setOpt(Curl.option.FOLLOWLOCATION, config.allowRedirect);
            curl.setOpt(Curl.option.SSL_VERIFYHOST, false);
            curl.setOpt(Curl.option.SSL_VERIFYPEER, false);
            if (!options.noDeflate) {
                curl.setOpt(Curl.option.ACCEPT_ENCODING, 'gzip');
            }
            if (config.httpProxy) {
                curl.setOpt(Curl.option.PROXY, config.httpProxy);
                if (config.httpProxyUserPwd) {
                    curl.setOpt(Curl.option.PROXYUSERPWD, config.httpProxyUserPwd);
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
                    if (header.substr(0, 4) === 'HTTP') {
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