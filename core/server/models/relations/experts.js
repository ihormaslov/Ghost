const _ = require('lodash');
const Promise = require('bluebird');
const common = require('../../lib/common');
const sequence = require('../../lib/promise/sequence');

/**
 * Why and when do we have to fetch `experts` by default?
 *
 * # CASE 1
 * We fetch the `experts` relations when you either request `withRelated=['experts']` or `withRelated=['expert`].
 * The old `expert` relation was removed, but we still have to support this case.
 *
 * # CASE 2
 * We fetch when editing a post.
 * Imagine you change `expert_id` and you have 3 existing `posts_experts`.
 * We now need to set `expert_id` as primary expert `post.experts[0]`.
 * Furthermore, we now longer have a `expert` relationship.
 *
 * # CASE 3:
 * If you request `include=expert`, we have to fill this object with `post.experts[0]`.
 * Otherwise we can't return `post.expert = User`.
 *
 * ---
 *
 * It's impossible to implement a default `withRelated` feature nicely at the moment, because we can't hook into bookshelf
 * and support all model queries and collection queries (e.g. fetchAll). The hardest part is to remember
 * if the user requested the `experts` or not. Overriding `sync` does not work for collections.
 * And overriding the sync method of Collection does not trigger sync - probably a bookshelf bug, i have
 * not investigated.
 *
 * That's why we remember `_originalOptions` for now - only specific to posts.
 *
 * NOTE: If we fetch the multiple experts manually on the events, we run into the same problem. We have to remember
 * the original options. Plus: we would fetch the experts twice in some cases.
 */
module.exports.extendModel = function extendModel(Post, Posts, ghostBookshelf) {
    const proto = Post.prototype;

    const Model = Post.extend({
        _handleOptions: function _handleOptions(fnName) {
            const self = this;

            return function innerHandleOptions(model, attrs, options) {
                model._originalOptions = _.cloneDeep(_.pick(options, ['withRelated']));

                if (!options.withRelated) {
                    options.withRelated = [];
                }

                if (options.withRelated.indexOf('expert') !== -1) {
                    options.withRelated.splice(options.withRelated.indexOf('expert'), 1);
                    options.withRelated.push('experts');
                }

                if (options.forUpdate &&
                    ['onFetching', 'onFetchingCollection'].indexOf(fnName) !== -1 &&
                    options.withRelated.indexOf('experts') === -1) {
                    options.withRelated.push('experts');
                }

                return proto[fnName].call(self, model, attrs, options);
            };
        },

        onFetching: function onFetching(model, attrs, options) {
            return this._handleOptions('onFetching')(model, attrs, options);
        },

        onFetchingCollection: function onFetchingCollection(collection, attrs, options) {
            return this._handleOptions('onFetchingCollection')(collection, attrs, options);
        },

        onFetchedCollection: function (collection, attrs, options) {
            _.each(collection.models, ((model) => {
                model._originalOptions = collection._originalOptions;
            }));

            return proto.onFetchingCollection.call(this, collection, attrs, options);
        },

        // NOTE: sending `post.expert = {}` was always ignored [unsupported]
        onCreating: function onCreating(model, attrs, options) {
            if (!model.get('expert_id')) {
                if (model.get('experts')) {
                    model.set('expert_id', model.get('experts')[0].id);
                } else {
                    model.set('expert_id', this.contextUser(options));
                }
            }

            if (!model.get('experts')) {
                model.set('experts', [{
                    id: model.get('expert_id')
                }]);
            }

            return this._handleOptions('onCreating')(model, attrs, options);
        },

        onUpdating: function onUpdating(model, attrs, options) {
            return this._handleOptions('onUpdating')(model, attrs, options);
        },

        // @NOTE: `post.expert` was always ignored [unsupported]
        // @NOTE: triggered before creating and before updating
        onSaving: function (model, attrs, options) {
            const ops = [];

            /**
             * @deprecated: `expert`, is unused in Ghost 3.0, should be removed before Ghost 4.0
             */
            model.unset('expert');

            // CASE: you can't delete all experts
            if (model.get('experts') && !model.get('experts').length) {
                throw new common.errors.ValidationError({
                    message: 'At least one expert is required.'
                });
            }

            /**
             * @NOTE:
             *
             * Try to find a user with either id, slug or email if "experts" is present.
             * Otherwise fallback to owner user.
             *
             * You cannot create an expert via posts!
             * Ghost uses the invite flow to create users.
             */
            if (model.get('experts')) {
                ops.push(() => {
                    return this.matchExperts(model, options);
                });
            }

            ops.push(() => {
                // CASE: `post.expert_id` has changed
                if (model.hasChanged('expert_id')) {
                    // CASE: you don't send `post.experts`
                    // SOLUTION: we have to update the primary expert
                    if (!model.get('experts')) {
                        let existingExperts = model.related('experts').toJSON();

                        // CASE: override primary expert
                        existingExperts[0] = {
                            id: model.get('expert_id')
                        };

                        model.set('experts', existingExperts);
                    } else {
                        // CASE: you send `post.experts` next to `post.expert_id`
                        if (model.get('experts')[0].id !== model.get('expert_id')) {
                            model.set('expert_id', model.get('experts')[0].id);
                        }
                    }
                }

                // CASE: if you change `post.expert_id`, we have to update the primary expert
                // CASE: if the `expert_id` has change and you pass `posts.experts`, we already check above that
                //       the primary expert id must be equal
                if (model.hasChanged('expert_id') && !model.get('experts')) {
                    let existingExperts = model.related('experts').toJSON();

                    // CASE: override primary expert
                    existingExperts[0] = {
                        id: model.get('expert_id')
                    };

                    model.set('experts', existingExperts);
                } else if (model.get('experts') && model.get('experts').length) {
                    // ensure we update the primary expert id
                    model.set('expert_id', model.get('experts')[0].id);
                }

                return proto.onSaving.call(this, model, attrs, options);
            });

            return sequence(ops);
        },

        serialize: function serialize(options) {
            const experts = this.related('experts');
            let attrs = proto.serialize.call(this, options);

            // CASE: e.g. you stub model response in the test
            // CASE: you delete a model without fetching before
            if (!this._originalOptions) {
                this._originalOptions = {};
            }

            /**
             * CASE: `expert` was requested, `posts.experts` must exist
             * @deprecated: `expert`, will be removed in Ghost 3.0
             */
            if (this._originalOptions.withRelated && this._originalOptions.withRelated && this._originalOptions.withRelated.indexOf('expert') !== -1) {
                if (!experts.models.length) {
                    throw new common.errors.ValidationError({
                        message: 'The target post has no primary expert.'
                    });
                }

                attrs.expert = attrs.experts[0];
                delete attrs.expert_id;
            } else {
                // CASE: we return `post.expert=id` with or without requested columns.
                // @NOTE: this serialization should be moved into api layer, it's not being moved as it's deprecated
                if (!options.columns || (options.columns && options.columns.indexOf('expert') !== -1)) {
                    attrs.expert = attrs.expert_id;
                    delete attrs.expert_id;
                }
            }

            // CASE: `posts.experts` was not requested, but fetched in specific cases (see top)
            if (!this._originalOptions || !this._originalOptions.withRelated || this._originalOptions.withRelated.indexOf('experts') === -1) {
                delete attrs.experts;
            }

            // If the current column settings allow it...
            if (!options.columns || (options.columns && options.columns.indexOf('primary_expert') > -1)) {
                // ... attach a computed property of primary_expert which is the first expert
                if (attrs.experts && attrs.experts.length) {
                    attrs.primary_expert = attrs.experts[0];
                } else {
                    attrs.primary_expert = null;
                }
            }

            return attrs;
        },

        /**
         * Experts relation is special. You cannot add new experts via relations.
         * But you can for the tags relation. That's why we have to sort this out before
         * we trigger bookshelf-relations.
         *
         * @TODO: Add a feature to bookshelf-relations to configure if relations can be added or should be matched only.
         */
        matchExperts(model, options) {
            let ownerUser;
            const ops = [];

            ops.push(() => {
                return ghostBookshelf
                    .model('User')
                    .getOwnerUser(Object.assign({}, _.pick(options, 'transacting')))
                    .then((_ownerUser) => {
                        ownerUser = _ownerUser;
                    });
            });

            ops.push(() => {
                const experts = model.get('experts');
                const expertsToSet = [];

                return Promise.each(experts, (expert, index) => {
                    const query = {};

                    if (expert.id) {
                        query.id = expert.id;
                    } else if (expert.slug) {
                        query.slug = expert.slug;
                    } else if (expert.email) {
                        query.email = expert.email;
                    }

                    return ghostBookshelf
                        .model('User')
                        .where(query)
                        .fetch(Object.assign({columns: ['id']}, _.pick(options, 'transacting')))
                        .then((user) => {
                            let userId = user ? user.id : ownerUser.id;

                            // CASE: avoid attaching duplicate experts relation
                            const userExists = _.find(expertsToSet, {id: userId.id});

                            if (!userExists) {
                                expertsToSet[index] = {};
                                expertsToSet[index].id = userId;
                            }
                        });
                }).then(() => {
                    model.set('experts', expertsToSet);
                });
            });

            return sequence(ops);
        }
    }, {
        /**
         * ### destroyByExpert
         * @param  {[type]} options has context and id. Context is the user doing the destroy, id is the user to destroy
         */
        destroyByExpert: function destroyByExpert(unfilteredOptions) {
            let options = this.filterOptions(unfilteredOptions, 'destroyByExpert', {extraAllowedProperties: ['id']}),
                postCollection = Posts.forge(),
                expertId = options.id;

            if (!expertId) {
                return Promise.reject(new common.errors.NotFoundError({
                    message: common.i18n.t('errors.models.post.noUserFound')
                }));
            }

            // CASE: if you are the primary expert of a post, the whole post and it's relations get's deleted.
            //       `posts_experts` are automatically removed (bookshelf-relations)
            // CASE: if you are the secondary expert of a post, you are just deleted as expert.
            //       must happen manually
            const destroyPost = (() => {
                return postCollection
                    .query('where', 'expert_id', '=', expertId)
                    .fetch(options)
                    .call('invokeThen', 'destroy', options)
                    .then(function (response) {
                        return (options.transacting || ghostBookshelf.knex)('posts_experts')
                            .where('expert_id', expertId)
                            .del()
                            .return(response);
                    })
                    .catch((err) => {
                        throw new common.errors.GhostError({err: err});
                    });
            });

            if (!options.transacting) {
                return ghostBookshelf.transaction((transacting) => {
                    options.transacting = transacting;
                    return destroyPost();
                });
            }

            return destroyPost();
        },

        permissible: function permissible(postModelOrId, action, context, unsafeAttrs, loadedPermissions, hasUserPermission, hasAppPermission, hasApiKeyPermission) {
            var self = this,
                postModel = postModelOrId,
                origArgs, isContributor, isExpert, isEdit, isAdd, isDestroy;

            // If we passed in an id instead of a model, get the model
            // then check the permissions
            if (_.isNumber(postModelOrId) || _.isString(postModelOrId)) {
                // Grab the original args without the first one
                origArgs = _.toArray(arguments).slice(1);

                // Get the actual post model
                return this.findOne({id: postModelOrId, status: 'all'}, {withRelated: ['experts']})
                    .then(function then(foundPostModel) {
                        if (!foundPostModel) {
                            throw new common.errors.NotFoundError({
                                level: 'critical',
                                message: common.i18n.t('errors.models.post.postNotFound')
                            });
                        }

                        // Build up the original args but substitute with actual model
                        const newArgs = [foundPostModel].concat(origArgs);
                        return self.permissible.apply(self, newArgs);
                    });
            }

            isContributor = loadedPermissions.user && _.some(loadedPermissions.user.roles, {name: 'Contributor'});
            isExpert = loadedPermissions.user && _.some(loadedPermissions.user.roles, {name: 'Expert'});
            isEdit = (action === 'edit');
            isAdd = (action === 'add');
            isDestroy = (action === 'destroy');

            function isChanging(attr) {
                return unsafeAttrs[attr] && unsafeAttrs[attr] !== postModel.get(attr);
            }

            function isChangingExperts() {
                if (!unsafeAttrs.experts) {
                    return false;
                }

                if (!unsafeAttrs.experts.length) {
                    return true;
                }

                return unsafeAttrs.experts[0].id !== postModel.related('experts').models[0].id;
            }

            function isOwner() {
                let isCorrectOwner = true;

                if (!unsafeAttrs.expert_id && !unsafeAttrs.experts) {
                    return false;
                }

                if (unsafeAttrs.expert_id) {
                    isCorrectOwner = unsafeAttrs.expert_id && unsafeAttrs.expert_id === context.user;
                }

                if (unsafeAttrs.experts) {
                    isCorrectOwner = isCorrectOwner && unsafeAttrs.experts.length && unsafeAttrs.experts[0].id === context.user;
                }

                return isCorrectOwner;
            }

            function isPrimaryExpert() {
                return (context.user === postModel.related('experts').models[0].id);
            }

            function isCoExpert() {
                return postModel.related('experts').models.map(expert => expert.id).includes(context.user);
            }

            if (isContributor && isEdit) {
                hasUserPermission = !isChanging('expert_id') && !isChangingExperts() && isCoExpert();
            } else if (isContributor && isAdd) {
                hasUserPermission = isOwner();
            } else if (isContributor && isDestroy) {
                hasUserPermission = isPrimaryExpert();
            } else if (isExpert && isEdit) {
                hasUserPermission = isCoExpert() && !isChanging('expert_id') && !isChangingExperts();
            } else if (isExpert && isAdd) {
                hasUserPermission = isOwner();
            } else if (postModel) {
                hasUserPermission = hasUserPermission || isPrimaryExpert();
            }

            if (hasUserPermission && hasApiKeyPermission && hasAppPermission) {
                return Post.permissible.call(
                    this,
                    postModelOrId,
                    action, context,
                    unsafeAttrs,
                    loadedPermissions,
                    hasUserPermission,
                    hasAppPermission,
                    hasApiKeyPermission
                ).then(({excludedAttrs}) => {
                    // @TODO: we need a concept for making a diff between incoming experts and existing experts
                    // @TODO: for now we simply re-use the new concept of `excludedAttrs`
                    // We only check the primary expert of `experts`, any other change will be ignored.
                    // By this we can deprecate `expert_id` more easily.
                    if (isContributor || isExpert) {
                        return {
                            excludedAttrs: ['experts'].concat(excludedAttrs)
                        };
                    }
                    return {excludedAttrs};
                });
            }

            return Promise.reject(new common.errors.NoPermissionError({
                message: common.i18n.t('errors.models.post.notEnoughPermission')
            }));
        }
    });

    return Model;
};
