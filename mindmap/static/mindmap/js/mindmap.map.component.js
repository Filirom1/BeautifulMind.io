/*!
 * jQuery lightweight plugin boilerplate
 * Original author: @ajpiano
 * Further changes, comments: @addyosmani
 * Licensed under the MIT license
 */

;
(function ($, window, document, undefined) {
    var version = '0.1',
        defaults = {
            cross_shift_offset:10
        };

    function MindMapComponent(self, opts) {
        var self = this;
        self.options = $.extend({}, defaults, opts);
        self._defaults = defaults;
        self.pk = undefined;
        self.map = undefined;
        self.map_pk = undefined;

        self._last_sent_dragg_pos = [0, 0];
        self._cross_shift_offset_total = [0, 0];
        self._cross_shift_offset_current = [0, 0];

        jsPlumb.ready(function () {
            self.init(opts);
        });
    }

    MindMapComponent.prototype.setId = function (id) {
        var self = this;
        self.pk = id;
        self.element.attr('id', 'mindmap-component-' + id);
        self.element.attr('data-component-pk', id);
    }

    MindMapComponent.prototype.init = function (opts) {
        var self = this;

        // set map container
        self.map = opts.container;
        self.map_pk = opts.container.data('map-pk');

        // clone component from tpl
        self.element = $('#component-tpl').clone().css('display', 'block');

        // set ids
        self.setId(opts.pk)

        // write parent pk
        self.element.attr('data-parent-component-pk', opts.parent_pk);

        // title stuff
        var title = $('.component-title:first', self.element);
        title.attr('value', opts.title);
        title.on('click', function () {
            title.focus();
            title.on('keydown', function (e) {
                if (e.keyCode == 13 || e.keyCode == 9) { // on enter or tab
                    title.blur();
                    return false;
                }
            });
        });

        // positioning
        self.element.css({
            left:opts.left,
            top:opts.top
        });

        // root component get special color
        if (opts.level == 0) {
            self.element.addClass('component-root');
        }

        // make compontent draggable
        jsPlumb.draggable(self.element, {
            scroll:true,
            stop:function () {
                var pos = self.element.position();

                // send last pos to client
                $.mindmapSockjs.send('update_component_pos', {
                    map_pk:self.map_pk,
                    component_pk:self.pk,
                    pos_left:pos.left,
                    pos_top:pos.top
                });

                // update last pos in db
                var url = bm_globals.mindmap.map_component_update_pos_url.replace('#1#', self.map_pk).replace('#2#', self.pk);
                $.ajax({
                    url:url,
                    type:'POST',
                    data:{
                        'pos_left':pos.left,
                        'pos_top':pos.top
                    },
                    cache:false
                });

                // save crosshift offset
                if (self._cross_shift_offset_total[0] || self._cross_shift_offset_total[1]) {
                    var url = bm_globals.mindmap.map_components_add_offset.replace('#1#', self.map_pk);
                    $.ajax({
                        url:url,
                        type:'POST',
                        data:{
                            'offset_left':self._cross_shift_offset_total[0],
                            'offset_top':self._cross_shift_offset_total[1],
                            'component_exclude_pk':self.pk
                        },
                        cache:false
                    });
                    self._cross_shift_offset_total = [0, 0];
                }

                // "flush" cross_shift_offset_current (send to client)
                if (self._cross_shift_offset_current[0] || self._cross_shift_offset_current[1]) {
                    $.mindmapSockjs.send('add_components_offset_except_one', {
                        map_pk:self.map_pk,
                        except_component_pk:self.pk,
                        offset_left:self._cross_shift_offset_current[0],
                        offset_top:self._cross_shift_offset_current[1]
                    });
                    self._cross_shift_offset_current = [0, 0];
                }
            },
            drag:function () {
                var pos = self.element.position();

                // get length vector last_pos->current-pos
                var length = Math.sqrt(
                    Math.pow(self._last_sent_dragg_pos[0] - pos.left, 2) + Math.pow(self._last_sent_dragg_pos[1] - pos.top, 2)
                );

                // special shift: shift all other components down/right if dragged component crosses top/left border
                if (pos.left < 0 || pos.top < 0) {
                    if (pos.left < 0) {
                        self._cross_shift_offset_current[0] += self.options.cross_shift_offset;
                        self._cross_shift_offset_total[0] += self.options.cross_shift_offset;
                    }
                    if (pos.top < 0) {
                        self._cross_shift_offset_current[1] += self.options.cross_shift_offset;
                        self._cross_shift_offset_total[1] += self.options.cross_shift_offset;
                    }

                    self.getComponentsExceptMyself().each(function () {
                        var comp_to_move = $(this),
                            comp_to_move_pos_left = comp_to_move.position().left + self.options.cross_shift_offset,
                            comp_to_move_pos_top = comp_to_move.position().top + self.options.cross_shift_offset;

                        if (pos.left < 0) {
                            comp_to_move.css({left:comp_to_move_pos_left});
                        }
                        if (pos.top < 0) {
                            comp_to_move.css({top:comp_to_move_pos_top});
                        }
                        jsPlumb.repaint(comp_to_move);
                    });

                    if (length > 20) {
                        $.mindmapSockjs.send('add_components_offset_except_one', {
                            map_pk:self.map_pk,
                            except_component_pk:self.pk,
                            offset_left:self._cross_shift_offset_current[0],
                            offset_top:self._cross_shift_offset_current[1]
                        });

                        self._cross_shift_offset_current = [0, 0];
                    }

                    self._last_sent_dragg_pos = [pos.left, pos.top];
                }
                // regular shift
                else if (length > 100) {
                    $.mindmapSockjs.send('update_component_pos', {
                        map_pk:self.map_pk,
                        component_pk:self.pk,
                        pos_left:pos.left,
                        pos_top:pos.top
                    });

                    self._last_sent_dragg_pos = [pos.left, pos.top];
                }
            }
        });

        // append component to map container
        opts.container.append(self.element);

        // draw connector of component is none root element
        if (opts.parent_pk) {
            var parent = $('#' + self.getDomId(opts.parent_pk));
            jsPlumb.connect({
                source:parent,
                target:self.element,
                anchor:'AutoDefault',
                paintStyle:{
                    lineWidth:2,
                    strokeStyle:'#4183c4',
                    outlineWidth:0.5,
                    outlineColor:'white'
                },
                endpoint:'Blank',
                connector:[ 'Bezier', { curviness:13 } ]
            });
        }

        self.element.on('click', '.btn-component-add', function () {
            var modal = $('#mindmap-component-new');
            modal.modal('show');
            $('#id_parent', modal).attr('value', self.element.data('data-component-pk') || '');
            $('#id_pos_left', modal).attr('value', 250);
            $('#id_pos_top', modal).attr('value', 90);
        });

        self.element.on('click', function () {
            self.toggleSelect();
        });

        return self;
    };

    MindMapComponent.prototype.toggleSelect = function () {
        var self = this;
        $('.component', self.map).removeClass('component-selected'); // deselect all components
        self.element.toggleClass('component-selected');
    }

    MindMapComponent.prototype.getDomId = function (id) {
        return 'mindmap-component-' + id;
    }

    MindMapComponent.prototype.getComponentsExceptMyself = function () {
        return $('.component:not(#' + this.getDomId(this.pk) + ')', this.map);
    }

    $.mindmapMapComponent = function (options) {
        return new MindMapComponent(this, options);
    }

})(jQuery, window, document);
