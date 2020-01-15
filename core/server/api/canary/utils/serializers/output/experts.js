const debug = require('ghost-ignition').debug('api:canary:utils:serializers:output:experts');
const mapper = require('./utils/mapper');

module.exports = {
    browse(models, apiConfig, frame) {
        debug('browse');

        frame.response = {
            experts: models.data.map(model => mapper.mapUser(model, frame)),
            meta: models.meta
        };
    },

    read(model, apiConfig, frame) {
        debug('read');

        frame.response = {
            experts: [mapper.mapUser(model, frame)]
        };
    }
};
