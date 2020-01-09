const ghostBookshelf = require('./base');
const user = require('./user');

const Expert = user.User.extend({
    shouldHavePosts: {
        joinTo: 'expert_id',
        joinTable: 'posts_experts'
    }
});

const Experts = ghostBookshelf.Collection.extend({
    model: Expert
});

module.exports = {
    Expert: ghostBookshelf.model('Expert', Expert),
    Experts: ghostBookshelf.collection('Experts', Experts)
};
