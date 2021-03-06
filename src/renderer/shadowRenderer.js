/**
 * @author xeolabs / https://github.com/xeolabs
 */

(function () {

    "use strict";

    xeogl.renderer.ShadowRenderer = function (gl, hash, scene, object) {

        this._gl = gl;
        this._hash = hash;
        this._shaderSource = new xeogl.renderer.ShadowShaderSource(gl, scene,  object);
        this._program = new xeogl.renderer.Program(gl, this._shaderSource);
        this._scene = scene;
        this._useCount = 0;

        if (this._program.errors) {
            this.errors = this._program.errors;
            return;
        }

        var program = this._program;

        this._uPositionsDecodeMatrix = program.getLocation("positionsDecodeMatrix");

        this._uModelMatrix = program.getLocation("modelMatrix");
        this._uViewMatrix = program.getLocation("viewMatrix");
        this._uProjMatrix = program.getLocation("projMatrix");

        this._uClips = {};
        var clips = scene.clips;
        for (var i = 0, len = clips.length; i < len; i++) {
            this._uClips.push({
                active: program.getLocation("clipActive" + i),
                pos: program.getLocation("clipPos" + i),
                dir: program.getLocation("clipDir" + i)
            });
        }

        this._aPosition = program.getAttribute("position");
        this._uClippable = program.getLocation("clippable");

        this._lastMaterialId = null;
        this._lastModelTransformId = null;
        this._lastVertexBufsId = null;
        this._lastGeometryId = null;
    };

    var renderers = {};

    xeogl.renderer.ShadowRenderer.create = function (gl, hash, scene, object) {
        var renderer = renderers[hash];
        if (!renderer) {
            renderer = new xeogl.renderer.ShadowRenderer(gl, hash, scene, object);
            renderers[hash] = renderer;
        }
        renderer._useCount++;
        return renderer;
    };

    xeogl.renderer.ShadowRenderer.prototype.destroy = function () {
        if (--this._useCount) {
            this._program.destroy();
            delete renderers[this._hash];
        }
    };

    xeogl.renderer.ShadowRenderer.prototype._bindProgram = function (frame) {

        var gl = this._gl;
        var scene = this._scene;

        this._program.bind();

        frame.useProgram++;

        this._lastLightId = null;
        this._lastMaterialId = null;
        this._lastModelTransformId = null;
        this._lastVertexBufsId = null;
        this._lastGeometryId = null;

        if (scene.clips.clips.length > 0) {
            var clips = scene.clips.clips;
            var clipUniforms;
            var uClipActive;
            var clip;
            var uClipPos;
            var uClipDir;
            for (var i = 0, len = this._uClips.length; i < len; i++) {
                clipUniforms = this._uClips[i];
                uClipActive = clipUniforms.active;
                clip = clips[i];
                if (uClipActive) {
                    gl.uniform1i(uClipActive, clip.active);
                }
                uClipPos = clipUniforms.pos;
                if (uClipPos) {
                    gl.uniform3fv(clipUniforms.pos, clip.pos);
                }
                uClipDir = clipUniforms.dir;
                if (uClipDir) {
                    gl.uniform3fv(clipUniforms.dir, clip.dir);
                }
            }
        }
    };

    xeogl.renderer.ShadowRenderer.prototype.drawObject = function (frame, object, light) {

        if (frame.lastProgramId !== this._program.id) {
            frame.lastProgramId = this._program.id;
            this._bindProgram(frame);
        }

        var gl = this._gl;
        var material = object.material;
        var modelTransform = object.modelTransform;
        var geometry = object.geometry;

        frame.textureUnit = 0;

        if (light.id !== this._lastLightId) {
            gl.uniformMatrix4fv(this._uViewMatrix, false, light.getShadowViewMatrix());
            gl.uniformMatrix4fv(this._uProjMatrix, false, light.getShadowProjMatrix());
            this._lastLightId = light.id;
        }

        // gl.uniformMatrix4fv(this._uViewMatrix, false, this._scene.viewTransform.matrix);
        // gl.uniformMatrix4fv(this._uProjMatrix, false, this._scene.projTransform.matrix);

        if (material.id !== this._lastMaterialId) {
            var backfaces = material.backfaces;
            if (frame.backfaces !== backfaces) {
                if (backfaces) {
                    gl.disable(gl.CULL_FACE);
                } else {
                    gl.enable(gl.CULL_FACE);
                }
                frame.backfaces = backfaces;
            }

            var frontface = material.frontface;
            if (frame.frontface !== frontface) {
                if (frontface) {
                    gl.frontFace(gl.CCW);
                } else {
                    gl.frontFace(gl.CW);
                }
                frame.frontface = frontface;
            }

            if (frame.lineWidth !== material.lineWidth) {
                gl.lineWidth(material.lineWidth);
                frame.lineWidth = material.lineWidth;
            }

            if (this._uPointSize) {
                gl.uniform1i(this._uPointSize, material.pointSize);
            }
            this._lastMaterialId = material.id;
        }

        if (modelTransform.id !== this._lastModelTransformId) {
            gl.uniformMatrix4fv(this._uModelMatrix, gl.FALSE, modelTransform.getMatrix());
            this._lastModelTransformId = modelTransform.id;
        }

        if (this._uClippable) {
            gl.uniform1i(this._uClippable, object.modes.clippable);
        }

        if (geometry.combined) {
            var vertexBufs = object.vertexBufs;
            if (vertexBufs.id !== this._lastVertexBufsId) {
                if (vertexBufs.positionsBuf && this._aPosition) {
                    this._aPosition.bindArrayBuffer(vertexBufs.positionsBuf, vertexBufs.quantized ? gl.UNSIGNED_SHORT : gl.FLOAT);
                    frame.bindArray++;
                }
                this._lastVertexBufsId = vertexBufs.id;
            }
        }

        if (geometry.id !== this._lastGeometryId) {

            if (this._uPositionsDecodeMatrix) {
                gl.uniformMatrix4fv(this._uPositionsDecodeMatrix, false, geometry.positionsDecodeMatrix);
            }

            if (geometry.combined) { // VBOs were bound by the preceding VertexBufs chunk
                if (geometry.indicesBufCombined) {
                    geometry.indicesBufCombined.bind();
                    frame.bindArray++;
                }
            } else {
                if (this._aPosition) {
                    this._aPosition.bindArrayBuffer(geometry.positionsBuf, geometry.quantized ? gl.UNSIGNED_SHORT : gl.FLOAT);
                    frame.bindArray++;
                }
                if (geometry.indicesBuf) {
                    geometry.indicesBuf.bind();
                    frame.bindArray++;
                }
            }
            this._lastGeometryId = geometry.id;
        }

        if (geometry.combined) {
            if (geometry.indicesBufCombined) {
                gl.drawElements(geometry.primitive, geometry.indicesBufCombined.numItems, geometry.indicesBufCombined.itemType, 0);
                frame.drawElements++;
            } else {
                // TODO: drawArrays() with VertexBufs positions
            }
        } else {
            if (geometry.indicesBuf) {
                gl.drawElements(geometry.primitive, geometry.indicesBuf.numItems, geometry.indicesBuf.itemType, 0);
                frame.drawElements++;
            } else if (geometry.positions) {
                gl.drawArrays(gl.TRIANGLES, 0, geometry.positions.numItems);
                frame.drawArrays++;
            }
        }
    };
})();



