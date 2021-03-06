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

import Vec2 from '../../util/vec2';

import op from '../shared/op';
import Action from '../shared/action';
import closest from '../shared/closest';

import { atomGetAttr } from './utils';
import { fromBondAddition } from './bond';

export function fromChain(restruct, p0, v, nSect, atomId) { // eslint-disable-line max-params
	var dx = Math.cos(Math.PI / 6);
	var dy = Math.sin(Math.PI / 6);

	var action = new Action();

	var frid;
	if (atomId != null)
		frid = atomGetAttr(restruct, atomId, 'fragment');
	else
		frid = action.addOp(new op.FragmentAdd().perform(restruct)).frid;

	var id0 = -1;
	if (atomId != null)
		id0 = atomId;
	else
		id0 = action.addOp(new op.AtomAdd({ label: 'C', fragment: frid }, p0).perform(restruct)).data.aid;

	action.operations.reverse();

	for (var i = 0; i < nSect; i++) {
		var pos = new Vec2(dx * (i + 1), i & 1 ? 0 : dy).rotate(v).add(p0);

		var a = closest.atom(restruct, pos, null, 0.1);
		var ret = fromBondAddition(restruct, {}, id0, a ? a.id : {}, pos);
		action = ret[0].mergeWith(action);
		id0 = ret[2];
	}

	return action;
}
