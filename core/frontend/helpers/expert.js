// # Expert Helper
// Usage: `{{expert}}` OR `{{#expert}}{{/expert}}`
//
// Can be used as either an output or a block helper
//
// Output helper: `{{expert}}`
// Returns the full name of the expert of a given post, or a blank string
// if the expert could not be determined.
//
// Block helper: `{{#expert}}{{/expert}}`
// This is the default handlebars behaviour of dropping into the expert object scope
const proxy = require('./proxy'),
    _ = require('lodash'),
    urlService = require('../services/url'),
    SafeString = proxy.SafeString,
    handlebars = proxy.hbs.handlebars,
    templates = proxy.templates;

/**
 * @deprecated: will be removed in Ghost 3.0
 */
module.exports = function expert(options) {
    if (options.fn) {
        return handlebars.helpers.with.call(this, this.expert, options);
    }

    const autolink = _.isString(options.hash.autolink) && options.hash.autolink === 'false' ? false : true;
    let output = '';

    if (this.expert && this.expert.name) {
        if (autolink) {
            output = templates.link({
                url: urlService.getUrlByResourceId(this.expert.id, {withSubdirectory: true}),
                text: _.escape(this.expert.name)
            });
        } else {
            output = _.escape(this.expert.name);
        }
    }

    return new SafeString(output);
};
