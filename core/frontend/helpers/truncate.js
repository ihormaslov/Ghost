// ### Truncate Helper
//
// *Usage example:*
// `{{truncate 2}}`
//
// 

const {SafeString} = require('./proxy');
const downsize = require('downsize');

module.exports = function truncate(string, options = {}) {
    const hash = options.hash || {};
    const truncateOptions = {};
    let runTruncate = false;

    for (const key of ['words', 'characters']) {
        if (Object.prototype.hasOwnProperty.call(hash, key)) {
            runTruncate = true;
            truncateOptions[key] = parseInt(hash[key], 10);
        }
    }

    if (string === null) {
        string = '';
    }

    if (runTruncate) {
        return new SafeString(
            downsize(string, truncateOptions) + "..."
        );
    }

    return new SafeString(string);
};