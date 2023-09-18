import { realpathSync, relative } from "fs";
import { dirname, resolve } from "path";
import { programVisitor } from "istanbul-lib-instrument";
import babelSyntaxObjectRestSpread from "babel-plugin-syntax-object-rest-spread";
const { GitRevisionPlugin } = require("@jimwong/git-revision-webpack-plugin");
const gitRevisionPlugin = new GitRevisionPlugin();

const testExclude = require("test-exclude");
const findUp = require("find-up");

function getRealpath(n) {
	try {
		return realpathSync(n) || n;
	} catch (e) {
		return n;
	}
}
function getRelativepath(n) {
	try {
		const cwd = getRealpath(process.env.NYC_CWD || process.cwd());
		const arr = n.split(cwd);
		return arr[1] || n;
	} catch (e) {
		return n;
	}
}

function makeShouldSkip() {
	let exclude;
	return function shouldSkip(file, opts) {
		if (!exclude) {
			const cwd = getRealpath(process.env.NYC_CWD || process.cwd());
			const nycConfig = process.env.NYC_CONFIG
				? JSON.parse(process.env.NYC_CONFIG)
				: {};

			let config = {};
			if (Object.keys(opts).length > 0) {
				// explicitly configuring options in babel
				// takes precedence.
				config = opts;
			} else if (nycConfig.include || nycConfig.exclude) {
				// nyc was configured in a parent process (keep these settings).
				config = {
					include: nycConfig.include,
					exclude: nycConfig.exclude,
				};
			} else {
				// fallback to loading config from key in package.json.
				config = {
					configKey: "nyc",
					configPath: dirname(findUp.sync("package.json", { cwd })),
				};
			}

			exclude = testExclude(Object.assign({ cwd }, config));
		}

		return !exclude.shouldInstrument(file);
	};
}

function getPath(_this) {
	// 根据 remote 获取 git repo 名
	const remoteArr = (gitRevisionPlugin.remote() || "").split("/");
	const projectName = remoteArr[remoteArr.length - 1].split(".")[0];

	return _this.opts.sourceFilePath === "relative"
		? `store\\${projectName}\\${gitRevisionPlugin.branch()}\\code${getRelativepath(
				_this.file.opts.filename.replace(/\//g, "\\"),
		  )}`
		: getRealpath(_this.file.opts.filename);
}

function makeVisitor({ types: t }) {
	const shouldSkip = makeShouldSkip();
	return {
		inherits: babelSyntaxObjectRestSpread,
		visitor: {
			Program: {
				enter(path) {
					this.__dv__ = null;
					const realPath = getRealpath(this.file.opts.filename);
					if (shouldSkip(realPath, this.opts)) {
						return;
					}
					let { inputSourceMap } = this.opts;
					if (this.opts.useInlineSourceMaps !== false) {
						inputSourceMap =
							inputSourceMap || this.file.opts.inputSourceMap;
					}

					const filePath = getPath(this);
					this.__dv__ = programVisitor(t, filePath, {
						coverageVariable: "__coverage__",
						inputSourceMap,
					});
					this.__dv__.enter(path);
				},
				exit(path) {
					if (!this.__dv__) {
						return;
					}
					const result = this.__dv__.exit(path);

					const filePath = getPath(this);
					if (this.opts.onCover) {
						this.opts.onCover(filePath, result.fileCoverage);
					}
				},
			},
		},
	};
}

export default makeVisitor;