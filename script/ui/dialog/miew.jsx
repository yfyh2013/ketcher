/****************************************************************************
 * Copyright 2017 EPAM Systems
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 ***************************************************************************/

import { camelCase } from 'lodash/fp';
import { h, Component } from 'preact';

import Dialog from '../component/dialog';
import { storage } from '../utils';

const MIEW_PATH = '__MIEW_PATH__';
const MIEW_OPTIONS = {
	preset: 'small',
	settings: {
		theme: 'light',
		atomLabel: 'bright',
		autoPreset: false,
		inversePanning: true
	},
	reps: [{
		mode: 'LN',
		colorer: 'AT',
		selector: 'all'
	}]
};

const MIEW_WINDOW = {
	location: 'no',
	menubar: 'no',
	toolbar: 'no',
	directories: 'no',
	modal: 'yes',
	alwaysRaised: 'yes'
};

const MIEW_MODES = {
	lines: 'LN',
	ballsAndSticks: 'BS',
	licorice: 'LC'
};

function getLocalMiewOpts() {
	const userOpts = storage.getItem('ketcher-opts');
	if (!userOpts)
		return MIEW_OPTIONS;

	const opts = MIEW_OPTIONS;

	if (userOpts.miewTheme)
		opts.settings.theme = camelCase(userOpts.miewTheme);

	if (userOpts.miewAtomLabel)
		opts.settings.atomLabel = camelCase(userOpts.miewAtomLabel);

	if (userOpts.miewMode)
		opts.reps[0].mode = MIEW_MODES[camelCase(userOpts.miewMode)];

	return opts;
}

function origin(url) {
	let loc = url;

	if (!loc.href) {
		loc = document.createElement('a');
		loc.href = url;
	}

	if (loc.origin)
		return loc.origin;

	if (!loc.hostname) // relative url, IE
		loc = document.location;

	return loc.protocol + '//' + loc.hostname + (!loc.port ? '' : ':' + loc.port);
}

function queryOptions(options, sep = '&') {
	if (Array.isArray(options)) {
		return options.reduce((res, item) => {
			const value = queryOptions(item);
			if (value !== null)
				res.push(value);
			return res;
		}, []).join(sep);
	} else if (typeof options === 'object') {
		return Object.keys(options).reduce((res, item) => {
			const value = options[item];
			res.push(typeof value === 'object' ?
				queryOptions(value) :
				encodeURIComponent(item) + '=' +
				encodeURIComponent(value));
			return res;
		}, []).join(sep);
	}
	return null;
}

function miewLoad(wnd, url, options = {}) { // TODO: timeout
	return new Promise((resolve) => {
		addEventListener('message', function onload(event) { // eslint-disable-line
			if (event.origin === origin(url) && event.data === 'miewLoadComplete') {
				window.removeEventListener('message', onload);
				const miew = wnd.MIEWS[0];
				miew._opts.load = false; // setOptions({ load: '' })
				miew._menuDisabled = true; // no way to disable menu after constructor return
				if (miew.init()) {
					miew.setOptions(options);
					miew.benchmarkGfx().then(() => {
						miew.run();
						setTimeout(() => resolve(miew), 10);
						// see setOptions message handler
					});
				}
			}
		});
	});
}

function miewSave(miew, url) {
	miew.saveData();
	return new Promise((resolve) => {
		addEventListener('message', function onsave(event) { // eslint-disable-line
			if (event.origin === origin(url) && event.data.startsWith('CML:')) {
				window.removeEventListener('message', onsave);
				resolve(atob(event.data.slice(4))); // eslint-disable-line no-undef
			}
		});
	});
}

class Miew extends Component {
	constructor(props) {
		console.info('init');
		super(props);
		this.opts = getLocalMiewOpts();
	}
	load(ev) {
		const miew = miewLoad(ev.target.contentWindow, MIEW_PATH, this.opts);
		this.setState({ miew });
		this.state.miew.then((res) => {
			res.parse(this.props.structStr, {
				fileType: 'cml',
				loaded: true
			});
			this.setState({ miew: res });
		});
	}
	save() {
		if (this.props.onOk) {
			const structStr = miewSave(this.state.miew, MIEW_PATH);
			this.setState({ structStr });
			this.state.structStr.then((str) => {
				this.props.onOk({ structStr: str });
			});
		}
	}
	window() {
		const opts = {
			...this.opts,
			load: `CML:${btoa(this.props.structStr)}`, // eslint-disable-line no-undef
			sourceType: 'message'
		};
		const br = this.base.getBoundingClientRect(); // Preact specifiec see: epa.ms/1NAYWp

		const wndProps = {
			...MIEW_WINDOW,
			top: Math.round(br.top),
			left: Math.round(br.left),
			width: Math.round(br.width),
			height: Math.round(br.height)
		};
		const wnd = window.open(`${MIEW_PATH}?${queryOptions(opts)}`,
			'miew', queryOptions(wndProps, ','));
		if (wnd) {
			this.props.onCancel();
			wnd.onload = function () {
				console.info('windowed');
			};
		}
	}
	render(props) {
		const { miew, structStr } = this.state;
		return (
			<Dialog
				title="3D View"
				className="miew"
				params={props}
				buttons={[
					'Close',
					<button
						disabled={miew instanceof Promise || structStr instanceof Promise}
						onClick={ev => this.save(ev)}
					>
						Apply
					</button>,
					<button
						className="window"
						disabled={/MSIE|rv:11/i.test(navigator.userAgent)} // eslint-disable-line no-undef
						onClick={() => this.window()}
					>
						Detach to new window
					</button>
				]}
			>
				<iframe
					id="miew-iframe"
					src={MIEW_PATH}
					onLoad={ev => this.load(ev)}
				/>
			</Dialog>
		);
	}
}

export default Miew;
