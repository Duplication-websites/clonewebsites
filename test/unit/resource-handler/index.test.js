const should = require('should');
const sinon = require('sinon');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const path = require('path');
const { getUnixPath } = require('../../../lib/utils');
const Resource = require('../../../lib/resource');
const ResourceHandler = require('../../../lib/resource-handler');

describe('ResourceHandler', function() {
	describe('constructor', function() {
		it('should pick supported options', function() {
			var options = {
				a: 1,
				b: 2,
				prettifyUrls: 'a',
				maxDepth: 'b',
				defaultFilename: 'test',
				sources: 'dummy sources'
			};
			var resHandler = new ResourceHandler(options);
			resHandler.options.should.eql({
				prettifyUrls: 'a',
				defaultFilename: 'test',
				sources: 'dummy sources'
			});
		});
		it('should set requestResource', function () {
			var resHandler = new ResourceHandler({}, { requestResource: 'requestResource' });
			resHandler.requestResource.should.eql('requestResource');
		});

		it('should init specific resource handlers', function() {
			var htmlHandlerStub = sinon.stub();
			var cssHandlerStub = sinon.stub();

			var ResourceHandler = proxyquire('../../../lib/resource-handler', {
				'./html': htmlHandlerStub,
				'./css': cssHandlerStub
			});

			var handleChildResStub = sinon.stub(ResourceHandler.prototype, 'downloadChildrenResources').usingPromise(Promise).resolves();
			var options = { defaultFilename: 'test' };
			var context = { dummy: 'context' };

			var resHandler = new ResourceHandler(options, context);
			should.exist(resHandler.htmlHandler);
			should.exist(resHandler.cssHandler);

			handleChildResStub.called.should.be.eql(false);

			htmlHandlerStub.calledOnce.should.be.eql(true);
			htmlHandlerStub.args[0][0].should.be.eql(options);
			htmlHandlerStub.args[0][1].downloadChildrenPaths();
			handleChildResStub.calledOnce.should.be.eql(true);

			cssHandlerStub.calledOnce.should.be.eql(true);
			cssHandlerStub.args[0][0].should.be.eql(options);
			cssHandlerStub.args[0][1].downloadChildrenPaths();
			handleChildResStub.calledTwice.should.be.eql(true);

			handleChildResStub.restore();
		});
	});

	describe('#getResourceHandler', () => {
		var resourceHandler;

		beforeEach(function() {
			resourceHandler = new ResourceHandler({});
		});

		it('should return css handler if file has css type', function() {
			var r = new Resource('http://example.com/');
			sinon.stub(r, 'getType').returns('css');

			var specificResourceHandler = resourceHandler.getResourceHandler(r);
			specificResourceHandler.should.be.eql(resourceHandler.cssHandler);
		});

		it('should return html handler if file has html type', function() {
			var r = new Resource('http://example.com/');
			sinon.stub(r, 'getType').returns('html');

			var specificResourceHandler = resourceHandler.getResourceHandler(r);
			specificResourceHandler.should.be.eql(resourceHandler.htmlHandler);
		});

		it('should return null if file has other type', function() {
			var r = new Resource('http://example.com/');
			sinon.stub(r, 'getType').returns('other');

			var specificResourceHandler = resourceHandler.getResourceHandler(r);
			should(specificResourceHandler).be.eql(null);
		});
	});

	describe('#handleResource', () => {
		var resHandler;

		beforeEach(function() {
			var options = { defaultFilename: 'test' };
			var context = {
				requestResource: sinon.stub().resolves(),
				loadResource: sinon.stub().resolves()
			};
			resHandler = new ResourceHandler(options, context);
		});

		it('should call getResourceHandler and execute specific resource handler', function() {
			var specificResourceHandleStub = sinon.stub().resolves();
			resHandler.getResourceHandler = sinon.stub().returns({
				handle: specificResourceHandleStub
			});

			var r = new Resource('http://example.com');
			return resHandler.handleResource(r).then(function() {
				specificResourceHandleStub.args[0][0].should.be.eql(r);
			});
		});

		it('should call getResourceHandler and return resolved promise if no specific handler found', function() {
			resHandler.getResourceHandler = sinon.stub().returns(null);

			var r = new Resource('http://example.com');
			return resHandler.handleResource(r).then(function(returnedResource) {
				should(returnedResource).be.eql(r);
			});
		});
	});

	describe('#downloadChildrenResources', () => {
		let pathContainer, parentResource, requestResourceStub, resHandler;

		beforeEach(() => {
			pathContainer = {};
			pathContainer.getPaths = sinon.stub();
			pathContainer.updateText = sinon.stub();

			parentResource = new Resource('http://example.com', 'test.txt');

			requestResourceStub = sinon.stub().returns(Promise.resolve());

			resHandler = new ResourceHandler({defaultFilename: 'index.html'}, {
				requestResource: requestResourceStub,
				getReference: ({resource}) => ({reference: getUnixPath(resource.filename)})
			});
		});

		it('should not call requestResource if no paths in text', () => {
			pathContainer.getPaths = sinon.stub().returns([]);

			return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
				requestResourceStub.called.should.be.eql(false);
			});
		});

		it('should call requestResource once with correct params', () => {
			pathContainer.getPaths.returns(['test.png']);
			parentResource.getUrl = sinon.stub().returns('http://test.com');

			return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
				requestResourceStub.calledOnce.should.be.eql(true);
				requestResourceStub.args[0][0].url.should.be.eql('http://test.com/test.png');
			});
		});

		it('should call requestResource for each found source with correct params', () => {
			pathContainer.getPaths.returns(['a.jpg', 'b.jpg', 'c.jpg']);
			parentResource.getUrl = sinon.stub().returns('http://test.com');

			return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
				requestResourceStub.calledThrice.should.be.eql(true);
				requestResourceStub.args[0][0].url.should.be.eql('http://test.com/a.jpg');
				requestResourceStub.args[1][0].url.should.be.eql('http://test.com/b.jpg');
				requestResourceStub.args[2][0].url.should.be.eql('http://test.com/c.jpg');
			});
		});

		it('should update paths in text with local files returned by requestResource', () => {
			pathContainer.getPaths.returns([
				'http://first.com/img/a.jpg',
				'http://first.com/b.jpg',
				'http://second.com/img/c.jpg'
			]);

			requestResourceStub.onCall(0).returns(Promise.resolve(new Resource('http://first.com/img/a.jpg', 'local' + path.sep + 'a.jpg')));
			requestResourceStub.onCall(1).returns(Promise.resolve(new Resource('http://first.com/b.jpg', 'local' + path.sep + 'b.jpg')));
			requestResourceStub.onCall(2).returns(Promise.resolve(new Resource('http://second.com/img/c.jpg', 'local' + path.sep + 'c.jpg')));

			var updateChildSpy = sinon.spy(parentResource, 'updateChild');

			return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
				var updateTextStub = pathContainer.updateText;
				updateTextStub.calledOnce.should.be.eql(true);
				updateTextStub.args[0][0].length.should.be.eql(3);
				updateTextStub.args[0][0].should.containEql({
					oldPath: 'http://first.com/img/a.jpg',
					newPath: 'local/a.jpg'
				});
				updateTextStub.args[0][0].should.containEql({
					oldPath: 'http://first.com/b.jpg',
					newPath: 'local/b.jpg'
				});
				updateTextStub.args[0][0].should.containEql({
					oldPath: 'http://second.com/img/c.jpg',
					newPath: 'local/c.jpg'
				});
				updateChildSpy.callCount.should.be.eql(3);
			});
		});

		it('should not update paths in text, for which requestResource returned null', () => {
			pathContainer.getPaths.returns([
				'http://first.com/img/a.jpg',
				'http://first.com/b.jpg',
				'http://second.com/img/c.jpg'
			]);

			requestResourceStub.onFirstCall().returns(Promise.resolve(null));
			requestResourceStub.onSecondCall().returns(Promise.resolve(null));
			requestResourceStub.onThirdCall().returns(Promise.resolve(new Resource('http://second.com/img/c.jpg', 'local/c.jpg')));

			var updateChildSpy = sinon.spy(parentResource, 'updateChild');

			return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
				var updateTextStub = pathContainer.updateText;
				updateTextStub.calledOnce.should.be.eql(true);
				updateTextStub.args[0][0].length.should.be.eql(1);
				updateTextStub.args[0][0].should.containEql({
					oldPath: 'http://second.com/img/c.jpg',
					newPath: 'local/c.jpg'
				});
				updateChildSpy.calledOnce.should.be.eql(true);
			});
		});

		it('should wait for all children promises fulfilled and then return updated text', () => {
			pathContainer.getPaths.returns([
				'http://first.com/img/a.jpg',
				'http://first.com/b.jpg',
				'http://second.com/img/c.jpg'
			]);

			pathContainer.updateText.returns('UPDATED TEXT');

			requestResourceStub.onFirstCall().returns(Promise.resolve(new Resource('http://first.com/img/a.jpg', 'local/a.jpg')));
			requestResourceStub.onSecondCall().returns(Promise.resolve(null));
			requestResourceStub.onThirdCall().returns(Promise.reject(new Error('some error')));

			return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function (updatedText) {
				updatedText.should.be.eql('UPDATED TEXT');
			});
		});

		describe('hash in urls', () => {
			it('should keep hash in urls', function () {
				var resourceStub = new Resource('http://example.com/page1.html', 'local/page1.html');
				sinon.stub(resourceStub, 'getType').returns('html');
				requestResourceStub.onFirstCall().returns(Promise.resolve(resourceStub));

				pathContainer.getPaths.returns(['http://example.com/page1.html#hash']);

				return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
					var updateTextStub = pathContainer.updateText;
					updateTextStub.calledOnce.should.be.eql(true);
					updateTextStub.args[0][0].length.should.be.eql(1);
					updateTextStub.args[0][0].should.containEql({
						oldPath: 'http://example.com/page1.html#hash',
						newPath: 'local/page1.html#hash'
					});
				});
			});
		});

		describe('prettifyUrls', () => {
			it('should not prettifyUrls by default', function() {
				var resourceStub = new Resource('http://example.com/other-page/index.html', 'other-page/index.html');
				requestResourceStub.onFirstCall().returns(Promise.resolve(resourceStub));

				pathContainer.getPaths.returns(['http://example.com/other-page/index.html']);


				return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
					var updateTextStub = pathContainer.updateText;
					updateTextStub.calledOnce.should.be.eql(true);
					updateTextStub.args[0][0].length.should.be.eql(1);
					updateTextStub.args[0][0].should.containEql({
						oldPath: 'http://example.com/other-page/index.html',
						newPath: 'other-page/index.html'
					});
				});
			});

			it('should prettifyUrls if specified', () => {
				var resourceStub = new Resource('http://example.com/other-page/index.html', 'other-page/index.html');
				requestResourceStub.onFirstCall().returns(Promise.resolve(resourceStub));

				pathContainer.getPaths.returns(['http://example.com/other-page/index.html']);
				resHandler.options.prettifyUrls = true;

				return resHandler.downloadChildrenResources(pathContainer, parentResource).then(function () {
					var updateTextStub = pathContainer.updateText;
					updateTextStub.calledOnce.should.be.eql(true);
					updateTextStub.args[0][0].length.should.be.eql(1);
					updateTextStub.args[0][0].should.containEql({
						oldPath: 'http://example.com/other-page/index.html',
						newPath: 'other-page/'
					});
				});
			});
		});
	});
});
