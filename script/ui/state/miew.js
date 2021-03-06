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

import { openDialog, load } from './';
import * as structFormat from '../structformat';

export function miewAction(dispatch, getState) {
	const editor = getState().editor;
	const server = getState().server;

	structFormat.toString(editor.struct(), 'cml', server)
		.then((cml) => {
			openDialog(dispatch, 'miew', {
				structStr: cml
			}).then((res) => {
				if (res.structStr)
					dispatch(load(res.structStr));
			});
		})
		.catch(e => alert(e.message)); // eslint-disable-line no-undef
}
