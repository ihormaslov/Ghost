const membersService = require('../../../../../../services/members');
const labs = require('../../../../../../services/labs');
const downsize = require('downsize');

const forPost = (attrs, frame) => {
    if (labs.isSet('members')) {
        const memberHasAccess = membersService.contentGating.checkPostAccess(attrs, frame.original.context.member);

        attrs.memberHasAccess = memberHasAccess;

        if (!memberHasAccess) {
            ['plaintext', 'html'].forEach((field) => {
                if (attrs[field] && frame.original.context.member){
                    const truncateOptions = {};
                    const wordsCount = parseInt(
                        (attrs[field].split(' ').length * 30) / 100
                    );
                    truncateOptions.words = wordsCount;
                    attrs[field] = downsize(attrs[field], truncateOptions);
                } else {
                    attrs[field] = '';
                }
            });
        }
    }

    return attrs;
};

module.exports.forPost = forPost;
