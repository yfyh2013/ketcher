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

import Struct from '../../chem/struct';

import op from '../shared/op';
import Action from '../shared/action';

import { atomGetAttr, atomGetDegree, atomGetNeighbors } from './utils';
import { removeSgroupIfNeeded, removeAtomFromSgroupIfNeeded } from './sgroup';
import { fromRGroupFragment } from './rgroup';
import { fromFragmentSplit } from './fragment';

export function fromAtomAddition(restruct, pos, atom) {
	atom = Object.assign({}, atom);
	const action = new Action();
	atom.fragment = action.addOp(new op.FragmentAdd().perform(restruct)).frid;
	action.addOp(new op.AtomAdd(atom, pos).perform(restruct));
	return action;
}

export function fromAtomDeletion(restruct, id) {
	let action = new Action();
	const atomsToRemove = [];

	const frid = restruct.molecule.atoms.get(id).fragment;

	atomGetNeighbors(restruct, id).forEach((nei) => {
		action.addOp(new op.BondDelete(nei.bid));// [RB] !!

		if (atomGetDegree(restruct, nei.aid) !== 1)
			return;

		if (removeAtomFromSgroupIfNeeded(action, restruct, nei.aid))
			atomsToRemove.push(nei.aid);

		action.addOp(new op.AtomDelete(nei.aid));
	});

	if (removeAtomFromSgroupIfNeeded(action, restruct, id))
		atomsToRemove.push(id);

	action.addOp(new op.AtomDelete(id));

	removeSgroupIfNeeded(action, restruct, atomsToRemove);

	action = action.perform(restruct);

	action.mergeWith(fromFragmentSplit(restruct, frid));

	return action;
}

/**
 * @param restruct { ReStruct }
 * @param ids { Array<number>|number }
 * @param attrs { object }
 * @param reset { boolean? }
 */
export function fromAtomsAttrs(restruct, ids, attrs, reset) {
	const action = new Action();
	const aids = Array.isArray(ids) ? ids : [ids];

	aids.forEach((aid) => {
		Object.keys(Struct.Atom.attrlist).forEach((key) => {
			if (!(key in attrs) && !reset)
				return;

			const value = (key in attrs) ? attrs[key] : Struct.Atom.attrGetDefault(key);
			action.addOp(new op.AtomAttr(aid, key, value));
		});

		if (!reset && 'label' in attrs && attrs.label !== null && attrs.label !== 'L#' && !attrs['atomList'])
			action.addOp(new op.AtomAttr(aid, 'atomList', null));
	});

	return action.perform(restruct);
}

/**
 * @param restruct { ReStruct }
 * @param srcId { number }
 * @param dstId { number }
 * @return { Action }
 */
export function fromAtomMerge(restruct, srcId, dstId) {
	if (srcId === dstId)
		return new Action();

	const fragAction = new Action();
	const srcFrid = atomGetAttr(restruct, srcId, 'fragment');
	const dstFrid = atomGetAttr(restruct, dstId, 'fragment');

	if (srcFrid !== dstFrid)
		mergeFragments(fragAction, restruct, srcFrid, dstFrid);

	const action = new Action();

	atomGetNeighbors(restruct, srcId).forEach((nei) => {
		const bond = restruct.molecule.bonds.get(nei.bid);

		if (dstId === bond.begin || dstId === bond.end) { // src & dst have one nei
			action.addOp(new op.BondDelete(nei.bid));
			return;
		}

		const begin = bond.begin === nei.aid ? nei.aid : dstId;
		const end = bond.begin === nei.aid ? dstId : nei.aid;

		const mergeBondId = restruct.molecule.findBondId(begin, end);

		if (mergeBondId === null) {
			action.addOp(new op.BondAdd(begin, end, bond));
		} else { // replace old bond with new bond
			const attrs = Struct.Bond.getAttrHash(bond);
			Object.keys(attrs).forEach((key) => {
				action.addOp(new op.BondAttr(mergeBondId, key, attrs[key]));
			});
		}

		action.addOp(new op.BondDelete(nei.bid));
	});

	const attrs = Struct.Atom.getAttrHash(restruct.molecule.atoms.get(srcId));

	if (atomGetDegree(restruct, srcId) === 1 && attrs['label'] === '*')
		attrs['label'] = 'C';

	Object.keys(attrs).forEach((key) => {
		action.addOp(new op.AtomAttr(dstId, key, attrs[key]));
	});

	const sgChanged = removeAtomFromSgroupIfNeeded(action, restruct, srcId);

	if (sgChanged)
		removeSgroupIfNeeded(action, restruct, [srcId]);

	action.addOp(new op.AtomDelete(srcId));

	return action.perform(restruct).mergeWith(fragAction);
}

export function mergeFragments(action, restruct, frid, frid2) {
	var struct = restruct.molecule;
	if (frid2 !== frid && (typeof frid2 === 'number')) {
		var rgid = Struct.RGroup.findRGroupByFragment(struct.rgroups, frid2);
		if (!(typeof rgid === 'undefined'))
			action.mergeWith(fromRGroupFragment(restruct, null, frid2));

		struct.atoms.forEach((atom, aid) => {
			if (atom.fragment === frid2)
				action.addOp(new op.AtomAttr(aid, 'fragment', frid).perform(restruct));
		});
		action.addOp(new op.FragmentDelete(frid2).perform(restruct));
	}
}
