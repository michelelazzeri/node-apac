"use strict"

const RSH = require('./request-signature-helper').RequestSignatureHelper
const Throttler = require('./throttler')
const locale = require('./locale')

const https = require('https')
const http = require('http')
const xml2js = require('xml2js')

const defaultXml2JsOptions = {
    explicitArray: false
}

class OperationHelper {
    constructor(params) {
        params = params || {}

        // check requried params
        if (typeof(params.awsId) === 'undefined') {
            throw new Error('Missing AWS Id param')
        }
        if (typeof(params.awsSecret) === 'undefined') {
            throw new Error('Missing AWS Secret param')
        }
        if (typeof(params.assocId) === 'undefined') {
            throw new Error('Missing Associate Id param')
        }

        // set instance variables from params
        this.awsId = params.awsId
        this.awsSecret = params.awsSecret
        this.assocId = params.assocId
        this.endPoint = params.endPoint || locale.getEndpointForLocale(params.locale)
        this.baseUri = params.baseUri || OperationHelper.defaultBaseUri
        this.xml2jsOptions = Object.assign({}, defaultXml2JsOptions, params.xml2jsOptions)
        this.throttler = new Throttler(params.maxRequestsPerSecond)
        if (typeof(params.proxyHostname) === 'string') this.proxyHostname = params.proxyHostname
        this.proxyPort = params.proxyPort || 8080
        if (typeof(params.proxyUsername) === 'string') this.proxyUsername = params.proxyUsername
        if (typeof(params.proxyPassword) === 'string') this.proxyPassword = params.proxyPassword

        // set version
        if (typeof(params.version) === 'string') OperationHelper.version = params.version
    }

    getSignatureHelper() {
        if (typeof(this.signatureHelper) === 'undefined') {
            var params = {}
            params[RSH.kAWSAccessKeyId] = this.awsId
            params[RSH.kAWSSecretKey] = this.awsSecret
            params[RSH.kEndPoint] = this.endPoint
            this.signatureHelper = new RSH(params)
        }
        return this.signatureHelper
    }

    generateParams(operation, params) {
        params.Service = OperationHelper.service
        params.Version = OperationHelper.version
        params.Operation = operation
        params.AWSAccessKeyId = this.awsId
        params.AssociateTag = this.assocId
        return params
    }

    generateUri(operation, params) {
        params = this.generateParams(operation, params)
        var helper = this.getSignatureHelper()
        params = helper.sign(params)
        var queryString = helper.canonicalize(params)
        return this.baseUri + '?' + queryString
    }

    execute(operation, params, callback) {
        const throttledAction = () => this._execute(operation, params, callback)
        return this.throttler.execute(throttledAction)
    }

    getQueueSize() {
      return this.throttler.getQueueSize()
    }

    _execute(operation, params, callback) {
        if (typeof(operation) === 'undefined') {
            throw new Error('Missing operation parameter')
        }
        if (typeof(params) === 'undefined') {
            params = {}
        }

        var uri = this.generateUri(operation, params)
        var host = this.endPoint
        var xml2jsOptions = this.xml2jsOptions

        var options = {
            hostname: host,
            path: uri,
            method: 'GET',
        }
        if (this.proxyHostname) {
            options = {
                hostname: this.proxyHostname,
                port: this.proxyPort,
                path: 'https://' + host + uri,
                method: 'GET',
                headers: {
                    Host: host
                }
            }
            if (this.proxyUsername) {
                var auth = 'Basic ' + new Buffer(this.proxyUsername + ':' + this.proxyPassword).toString('base64')
                options.headers["Proxy-Authorization"] = auth
            }
        }

        var responseBody = ''

        const promise = new Promise((resolve, reject) => {
            var request = (this.proxyHostname? http: https).request(options, function (response) {
                response.setEncoding('utf8')

                response.on('data', function (chunk) {
                    responseBody += chunk
                })

                response.on('end', function () {
                    xml2js.parseString(responseBody, xml2jsOptions, function (err, result) {
                        if (callback) callback(err, result, responseBody)
                        else if (err) reject(err)
                        else resolve({
                            result,
                            responseBody
                        })
                    })
                })
            })

            request.on('error', function (err) {
                if (callback) callback(err)
                else reject(err)
            })

            request.end()
        })

        if (!callback) return promise
    }
}

OperationHelper.version = '2013-08-01'
OperationHelper.service = 'AWSECommerceService'
OperationHelper.defaultBaseUri = '/onca/xml'

exports.OperationHelper = OperationHelper
