'use strict';
// # Experts Helper
// Usage: `{{experts}}`, `{{experts separator=' - '}}`
//
// Returns a string of the experts on the post.
// By default, experts are separated by commas.
//
// Note that the standard {{#each experts}} implementation is unaffected by this helper.
const proxy = require('./proxy');
const _ = require('lodash');
const urlService = require('../services/url');
const {SafeString, templates} = proxy;
const ghostHelperUtils = require('@tryghost/helpers').utils;

module.exports = function experts(options = {}) {
    options.hash = options.hash || {};
    let {
        autolink,
        separator = ', ',
        prefix = '',
        suffix = '',
        limit,
        visibility,
        from = 1,
        to
    } = options.hash;
    let output = '';

    autolink = !(_.isString(autolink) && autolink === 'false');
    limit = limit ? parseInt(limit, 10) : limit;
    from = from ? parseInt(from, 10) : from;
    to = to ? parseInt(to, 10) : to;

    function createExpertsList(experts) {
        function processExpert(expert) {
            return autolink ? templates.link({
                url: urlService.getUrlByResourceId(expert.id, {withSubdirectory: true}),
                text: _.escape(expert.name)
            }) : _.escape(expert.name);
        }

        return ghostHelperUtils.visibility.filter(experts, visibility, processExpert);
    }

    if (this.experts && this.experts.length) {
        output = createExpertsList(this.experts);
        from -= 1; // From uses 1-indexed, but array uses 0-indexed.
        to = to || limit + from || output.length;
        output = output.slice(from, to).join(separator);
    }

    if (output) {
        output = prefix + output + suffix;
    }

    return new SafeString(output);
};
