var Set = require('../../util/set');
var util = require('../../util');

var Struct = require('../struct');
var CisTrans = require('./cis_trans');
var Dfs = require('./dfs');
var Stereocenters = require('./stereocenters');

var Smiles = function ()
{
	this.smiles = '';
	this._written_atoms = [];
	this._written_components = 0;

	this.ignore_errors = false;
};

Smiles._Atom = function (h_count)
{
	this.neighbours = [];  // Array of integer pairs {a, b}
	this.aromatic = false;          // has aromatic bond
	this.lowercase = false;         // aromatic and has to be written lowercase
	this.chirality = 0;             // 0 means no chirality, 1 means CCW pyramid, 2 means CW pyramid
	this.branch_cnt = 0;            // runs from 0 to (branches - 1)
	this.paren_written = false;
	this.h_count = h_count;
	this.parent = -1;
};

// NB: only loops of length up to 6 are included here
Smiles.prototype.isBondInRing = function (bid) {
	if (util.isUndefined(this.inLoop) || util.isNull(this.inLoop))
		throw new Error('Init this.inLoop prior to calling this method');
	return this.inLoop[bid];
};

Smiles.prototype.saveMolecule = function (molecule, ignore_errors)
{
	var i, j, k;

	if (!Object.isUndefined(ignore_errors))
		this.ignore_errors = ignore_errors;

	//[RB]: KETCHER-498 (Incorrect smile-string for multiple Sgroup)
	//TODO the fix is temporary, still need to implement error handling/reporting
	//BEGIN
//    if (molecule.sgroups.count() > 0 && !this.ignore_errors)
//        throw new Error("SMILES doesn't support s-groups");
	molecule = molecule.clone();
	molecule.initHalfBonds();
	molecule.initNeighbors();
	molecule.sortNeighbors();
	molecule.setImplicitHydrogen();
	molecule.sgroups.each(function (sgid, sg) {
		if (sg.type == 'MUL') {
			try {
				Struct.SGroup.prepareMulForSaving(sg, molecule);
			} catch(ex) {
					throw { message: 'Bad s-group (' + ex.message + ')' };
				}
		} else if (!this.ignore_errors) {
			throw new Error('SMILES data format doesn\'t support s-groups');
		}
	}, this);
	//END

	this.atoms = new Array(molecule.atoms.count());

	molecule.atoms.each(function (aid, atom)
	{
		this.atoms[aid] = new Smiles._Atom(atom.implicitH);
	}, this);

	// From the SMILES specification:
	// Please note that only atoms on the following list
	// can be considered aromatic: C, N, O, P, S, As, Se, and * (wildcard).
	var allowed_lowercase = ['B', 'C', 'N', 'O', 'P', 'S', 'Se', 'As'];

	// Detect atoms that have aromatic bonds and count neighbours
	molecule.bonds.each(function (bid, bond)
	{
		if (bond.type == Struct.Bond.PATTERN.TYPE.AROMATIC)
		{
			this.atoms[bond.begin].aromatic = true;
			if (allowed_lowercase.indexOf(molecule.atoms.get(bond.begin).label) != -1)
				this.atoms[bond.begin].lowercase = true;
			this.atoms[bond.end].aromatic = true;
			if (allowed_lowercase.indexOf(molecule.atoms.get(bond.end).label) != -1)
				this.atoms[bond.end].lowercase = true;
		}
		this.atoms[bond.begin].neighbours.push({aid: bond.end, bid: bid});
		this.atoms[bond.end].neighbours.push({aid: bond.begin, bid: bid});
	}, this);

	this.inLoop = (function () {
		molecule.prepareLoopStructure();
		var bondsInLoops = Set.empty();
		molecule.loops.each(function (lid, loop) {
			if (loop.hbs.length <= 6)
				Set.mergeIn(bondsInLoops, Set.fromList(loop.hbs.map(function (hbid) {
					return molecule.halfBonds.get(hbid).bid;
				})));
		});
		var inLoop = {};
		Set.each(bondsInLoops, function (bid) {
			inLoop[bid] = 1;
		}, this);
		return inLoop;
	})();

	this._touched_cistransbonds = 0;
	this._markCisTrans(molecule);

	var components = molecule.getComponents();
	var componentsAll = components.reactants.concat(components.products);

	var walk = new Dfs(molecule, this.atoms, componentsAll, components.reactants.length);

	walk.walk();

	this.atoms.each(function (atom)
	{
		atom.neighbours.clear();
	}, this);

	// fill up neighbor lists for the stereocenters calculation
	for (i = 0; i < walk.v_seq.length; i++)
	{
		var seq_el = walk.v_seq[i];
		var v_idx = seq_el.idx;
		var e_idx = seq_el.parent_edge;
		var v_prev_idx = seq_el.parent_vertex;

		if (e_idx >= 0)
		{
			var atom = this.atoms[v_idx];

			var opening_cycles = walk.numOpeningCycles(e_idx);

			for (j = 0; j < opening_cycles; j++)
				this.atoms[v_prev_idx].neighbours.push({aid: -1, bid: -1});

			if (walk.edgeClosingCycle(e_idx))
			{
				for (k = 0; k < atom.neighbours.length; k++)
				{
					if (atom.neighbours[k].aid == -1)
					{
						atom.neighbours[k].aid = v_prev_idx;
						atom.neighbours[k].bid = e_idx;
						break;
					}
				}
				if (k == atom.neighbours.length)
					throw new Error('internal: can not put closing bond to its place');
			}
			else
			{
				atom.neighbours.push({aid: v_prev_idx, bid: e_idx});
				atom.parent = v_prev_idx;
			}
			this.atoms[v_prev_idx].neighbours.push({aid: v_idx, bid: e_idx});
		}
	}

	try {
		// detect chiral configurations
		var stereocenters = new Stereocenters(molecule, function (idx)
		{
			return this.atoms[idx].neighbours;
		}, this);
		stereocenters.buildFromBonds(this.ignore_errors);

		stereocenters.each (function (atom_idx, sc)
		{
			//if (sc.type < MoleculeStereocenters::ATOM_AND)
			//    continue;

			var implicit_h_idx = -1;

			if (sc.pyramid[3] == -1)
				implicit_h_idx = 3;
			/*
			else for (j = 0; j < 4; j++)
				if (ignored_vertices[pyramid[j]])
				{
					implicit_h_idx = j;
					break;
				}
				*/

			var pyramid_mapping = new Array(4);
			var counter = 0;

			var atom = this.atoms[atom_idx];

			if (atom.parent != -1)
				for (k = 0; k < 4; k++)
					if (sc.pyramid[k] == atom.parent)
					{
						pyramid_mapping[counter++] = k;
						break;
					}

			if (implicit_h_idx != -1)
				pyramid_mapping[counter++] = implicit_h_idx;

			for (j = 0; j != atom.neighbours.length; j++)
			{
				if (atom.neighbours[j].aid == atom.parent)
					continue;

				for (k = 0; k < 4; k++)
					if (atom.neighbours[j].aid == sc.pyramid[k])
					{
						if (counter >= 4)
							throw new Error('internal: pyramid overflow');
						pyramid_mapping[counter++] = k;
						break;
					}
			}

			if (counter == 4)
			{
				// move the 'from' atom to the end
				counter = pyramid_mapping[0];
				pyramid_mapping[0] = pyramid_mapping[1];
				pyramid_mapping[1] = pyramid_mapping[2];
				pyramid_mapping[2] = pyramid_mapping[3];
				pyramid_mapping[3] = counter;
			}
			else if (counter != 3)
				throw new Error('cannot calculate chirality');

			if (Stereocenters.isPyramidMappingRigid(pyramid_mapping))
				this.atoms[atom_idx].chirality = 1;
			else
				this.atoms[atom_idx].chirality = 2;
		}, this);
	} catch (ex) {
			alert('Warning: ' + ex.message);
		}

	// write the SMILES itself

	// cycle_numbers[i] == -1 means that the number is available
	// cycle_numbers[i] == n means that the number is used by vertex n
	var cycle_numbers = [];

	cycle_numbers.push(0); // never used

	var first_component = true;

	for (i = 0; i < walk.v_seq.length; i++)
	{
		seq_el = walk.v_seq[i];
		v_idx = seq_el.idx;
		e_idx = seq_el.parent_edge;
		v_prev_idx = seq_el.parent_vertex;
		var write_atom = true;

		if (v_prev_idx >= 0)
		{
			if (walk.numBranches(v_prev_idx) > 1)
			if (this.atoms[v_prev_idx].branch_cnt > 0 && this.atoms[v_prev_idx].paren_written)
				this.smiles += ')';

			opening_cycles = walk.numOpeningCycles(e_idx);

			for (j = 0; j < opening_cycles; j++)
			{
				for (k = 1; k < cycle_numbers.length; k++)
					if (cycle_numbers[k] == -1)
						break;
				if (k == cycle_numbers.length)
					cycle_numbers.push(v_prev_idx);
				else
					cycle_numbers[k] = v_prev_idx;

				this._writeCycleNumber(k);
			}

			if (v_prev_idx >= 0)
			{
				var branches = walk.numBranches(v_prev_idx);

				if (branches > 1)
				if (this.atoms[v_prev_idx].branch_cnt < branches - 1)
				{
					if (walk.edgeClosingCycle(e_idx))
						this.atoms[v_prev_idx].paren_written = false;
					else
					{
						this.smiles += '(';
						this.atoms[v_prev_idx].paren_written = true;
					}
				}

				this.atoms[v_prev_idx].branch_cnt++;

				if (this.atoms[v_prev_idx].branch_cnt > branches)
					throw new Error('unexpected branch');
			}

			var bond = molecule.bonds.get(e_idx);

			var dir = 0;

			if (bond.type == Struct.Bond.PATTERN.TYPE.SINGLE)
				dir = this._calcBondDirection(molecule, e_idx, v_prev_idx);

			if ((dir == 1 && v_idx == bond.end) || (dir == 2 && v_idx == bond.begin))
				this.smiles += '/';
			else if ((dir == 2 && v_idx == bond.end) || (dir == 1 && v_idx == bond.begin))
				this.smiles += '\\';
			else if (bond.type == Struct.Bond.PATTERN.TYPE.ANY)
				this.smiles += '~';
			else if (bond.type == Struct.Bond.PATTERN.TYPE.DOUBLE)
				this.smiles += '=';
			else if (bond.type == Struct.Bond.PATTERN.TYPE.TRIPLE)
				this.smiles += '#';
			else if (bond.type == Struct.Bond.PATTERN.TYPE.AROMATIC &&
			(!this.atoms[bond.begin].lowercase || !this.atoms[bond.end].lowercase || !this.isBondInRing(e_idx)))
				this.smiles += ':'; // TODO: Check if this : is needed
			else if (bond.type == Struct.Bond.PATTERN.TYPE.SINGLE && this.atoms[bond.begin].aromatic && this.atoms[bond.end].aromatic)
				this.smiles += '-';



			if (walk.edgeClosingCycle(e_idx))
			{
				for (j = 1; j < cycle_numbers.length; j++)
					if (cycle_numbers[j] == v_idx)
						break;

				if (j == cycle_numbers.length)
					throw new Error('cycle number not found');

				this._writeCycleNumber(j);

				cycle_numbers[j] = -1;
				write_atom = false;
			}
		}
		else
		{
			if (!first_component)
				this.smiles += (this._written_components == walk.nComponentsInReactants) ? '>>' : '.';
			first_component = false;
			this._written_components++;
		}
		if (write_atom) {
			this._writeAtom(molecule, v_idx, this.atoms[v_idx].aromatic, this.atoms[v_idx].lowercase, this.atoms[v_idx].chirality);
			this._written_atoms.push(seq_el.idx);
		}
	}

	this.comma = false;

	//this._writeStereogroups(mol, atoms);
	this._writeRadicals(molecule);
	//this._writePseudoAtoms(mol);
	//this._writeHighlighting();

	if (this.comma)
		this.smiles += '|';

	return this.smiles;

};

Smiles.prototype._writeCycleNumber = function (n)
{
	if (n > 0 && n < 10)
		this.smiles += n;
	else if (n >= 10 && n < 100)
		this.smiles += '%' + n;
	else if (n >= 100 && n < 1000)
		this.smiles += '%%' + n;
	else
		throw new Error('bad cycle number: ' + n);
};

Smiles.prototype._writeAtom = function (mol, idx, aromatic, lowercase, chirality)
{
	var atom = mol.atoms.get(idx);
	var need_brackets = false;
	var hydro = -1;
	var aam = 0;

	/*
	if (mol.haveQueryAtoms())
	{
	  query_atom = &mol.getQueryAtom(idx);

	  if (query_atom->type == QUERY_ATOM_RGROUP)
	  {
		 if (mol.getRGroups()->isRGroupAtom(idx))
		 {
			const Array<int> &rg = mol.getRGroups()->getSiteRGroups(idx);

			if (rg.size() != 1)
			   throw Error("rgroup count %d", rg.size());

			_output.printf("[&%d]", rg[0] + 1);
		 }
		 else
			_output.printf("[&%d]", 1);

		 return;
	  }
	}
	*/

	if (atom.label == 'A')
	{
		this.smiles += '*';
		return;
	}

	if (atom.label == 'R' || atom.label == 'R#')
	{
		this.smiles += '[*]';
		return;
	}

	//KETCHER-598 (Ketcher does not save AAM into reaction SMILES)
	//BEGIN
//    if (this.atom_atom_mapping)
//        aam = atom_atom_mapping[idx];
	aam = atom.aam;
	//END

	if (atom.label != 'C' && atom.label != 'P' &&
	atom.label != 'N' && atom.label != 'S' &&
	atom.label != 'O' && atom.label != 'Cl' &&
	atom.label != 'F' && atom.label != 'Br' &&
	atom.label != 'B' && atom.label != 'I')
		need_brackets = true;

	if (atom.explicitValence >= 0 || atom.radical != 0 || chirality > 0 ||
		(aromatic && atom.label != 'C' && atom.label != 'O') ||
	(aromatic && atom.label == 'C' && this.atoms[idx].neighbours.length < 3 && this.atoms[idx].h_count == 0))
		hydro = this.atoms[idx].h_count;

	var label = atom.label;
	if (atom.atomList && !atom.atomList.notList) {
		label = atom.atomList.label();
		need_brackets = false; // atom list label already has brackets
	} else if (atom.isPseudo() || (atom.atomList && atom.atomList.notList)) {
		label = '*';
		need_brackets = true;
	} else if (chirality || atom.charge != 0 || atom.isotope > 0 || hydro >= 0 || aam > 0) {
		need_brackets = true;
	}

	if (need_brackets)
	{
		if (hydro == -1)
			hydro = this.atoms[idx].h_count;
		this.smiles += '[';
	}

	if (atom.isotope > 0)
		this.smiles += atom.isotope;

	if (lowercase)
		this.smiles += label.toLowerCase();
	else
		this.smiles += label;

	if (chirality > 0)
	{
		if (chirality == 1)
			this.smiles += '@';
		else // chirality == 2
			this.smiles += '@@';

		if (atom.implicitH > 1)
			throw new Error(atom.implicitH + ' implicit H near stereocenter');
	}

	if (atom.label != 'H') {
		if (hydro > 1 || (hydro == 0 && !need_brackets))
			this.smiles += 'H' + hydro;
		else if (hydro == 1)
			this.smiles += 'H';
	}

	if (atom.charge > 1)
		this.smiles += '+' + atom.charge;
	else if (atom.charge < -1)
		this.smiles += atom.charge;
	else if (atom.charge == 1)
		this.smiles += '+';
	else if (atom.charge == -1)
		this.smiles += '-';

	if (aam > 0)
		this.smiles += ':' + aam;

	if (need_brackets)
		this.smiles += ']';

	/*
	if (mol.getRGroupFragment() != 0)
	{
	  for (i = 0; i < 2; i++)
	  {
		 int j;

		 for (j = 0; mol.getRGroupFragment()->getAttachmentPoint(i, j) != -1; j++)
			if (idx == mol.getRGroupFragment()->getAttachmentPoint(i, j))
			{
			   _output.printf("([*])");
			   break;
			}

		 if (mol.getRGroupFragment()->getAttachmentPoint(i, j) != -1)
			break;
	  }
	}
	*/
};

Smiles.prototype._markCisTrans = function (mol)
{
	this.cis_trans = new CisTrans (mol, function (idx)
	{
		return this.atoms[idx].neighbours;
	}, this);
	this.cis_trans.build();
	this._dbonds = new Array(mol.bonds.count());

	mol.bonds.each(function (bid)
	{
		this._dbonds[bid] =
		{
			ctbond_beg: -1,
			ctbond_end: -1,
			saved: 0
		}
	}, this);

	this.cis_trans.each(function (bid, ct)
	{
		var bond = mol.bonds.get(bid);

		if (ct.parity != 0 && !this.isBondInRing(bid))
		{
			var nei_beg = this.atoms[bond.begin].neighbours;
			var nei_end = this.atoms[bond.end].neighbours;
			var arom_fail_beg = true, arom_fail_end = true;

			nei_beg.each(function (nei)
			{
				if (nei.bid != bid && mol.bonds.get(nei.bid).type == Struct.Bond.PATTERN.TYPE.SINGLE)
					arom_fail_beg = false;
			}, this);

			nei_end.each(function (nei)
			{
				if (nei.bid != bid && mol.bonds.get(nei.bid).type == Struct.Bond.PATTERN.TYPE.SINGLE)
					arom_fail_end = false;
			}, this);

			if (arom_fail_beg || arom_fail_end)
				return;

			nei_beg.each(function (nei)
			{
				if (nei.bid != bid)
				{
					if (mol.bonds.get(nei.bid).begin == bond.begin)
						this._dbonds[nei.bid].ctbond_beg = bid;
					else
						this._dbonds[nei.bid].ctbond_end = bid;
				}
			}, this);

			nei_end.each(function (nei)
			{
				if (nei.bid != bid)
				{
					if (mol.bonds.get(nei.bid).begin == bond.end)
						this._dbonds[nei.bid].ctbond_beg = bid;
					else
						this._dbonds[nei.bid].ctbond_end = bid;
				}
			}, this);
		}
	}, this);
};

Smiles.prototype._updateSideBonds = function (mol, bond_idx)
{
	var bond = mol.bonds.get(bond_idx);
	var subst = this.cis_trans.getSubstituents(bond_idx);
	var parity = this.cis_trans.getParity(bond_idx);

	var sidebonds = [-1, -1, -1, -1];

	sidebonds[0] = mol.findBondId(subst[0], bond.begin);
	if (subst[1] != -1)
		sidebonds[1] = mol.findBondId(subst[1], bond.begin);

	sidebonds[2] = mol.findBondId(subst[2], bond.end);
	if (subst[3] != -1)
		sidebonds[3] = mol.findBondId(subst[3], bond.end);

	var n1 = 0, n2 = 0, n3 = 0, n4 = 0;

	if (this._dbonds[sidebonds[0]].saved != 0)
	{
		if ((this._dbonds[sidebonds[0]].saved == 1 && mol.bonds.get(sidebonds[0]).begin == bond.begin) ||
		(this._dbonds[sidebonds[0]].saved == 2 && mol.bonds.get(sidebonds[0]).end == bond.begin))
			n1++;
		else
			n2++;
	}
	if (sidebonds[1] != -1 && this._dbonds[sidebonds[1]].saved != 0)
	{
		if ((this._dbonds[sidebonds[1]].saved == 2 && mol.bonds.get(sidebonds[1]).begin == bond.begin) ||
		(this._dbonds[sidebonds[1]].saved == 1 && mol.bonds.get(sidebonds[1]).end == bond.begin))
			n1++;
		else
			n2++;
	}
	if (this._dbonds[sidebonds[2]].saved != 0)
	{
		if ((this._dbonds[sidebonds[2]].saved == 1 && mol.bonds.get(sidebonds[2]).begin == bond.end) ||
		(this._dbonds[sidebonds[2]].saved == 2 && mol.bonds.get(sidebonds[2]).end == bond.end))
			n3++;
		else
			n4++;
	}
	if (sidebonds[3] != -1 && this._dbonds[sidebonds[3]].saved != 0)
	{
		if ((this._dbonds[sidebonds[3]].saved == 2 && mol.bonds.get(sidebonds[3]).begin == bond.end) ||
		(this._dbonds[sidebonds[3]].saved == 1 && mol.bonds.get(sidebonds[3]).end == bond.end))
			n3++;
		else
			n4++;
	}

	if (parity == CisTrans.PARITY.CIS)
	{
		n1 += n3;
		n2 += n4;
	}
	else
	{
		n1 += n4;
		n2 += n3;
	}

	if (n1 > 0 && n2 > 0)
		throw new Error('incompatible cis-trans configuration');

	if (n1 == 0 && n2 == 0)
		return false;

	if (n1 > 0)
	{
		this._dbonds[sidebonds[0]].saved =
			(mol.bonds.get(sidebonds[0]).begin == bond.begin) ? 1 : 2;
		if (sidebonds[1] != -1)
			this._dbonds[sidebonds[1]].saved =
				(mol.bonds.get(sidebonds[1]).begin == bond.begin) ? 2 : 1;

		this._dbonds[sidebonds[2]].saved =
			((mol.bonds.get(sidebonds[2]).begin == bond.end) == (parity == CisTrans.PARITY.CIS)) ? 1 : 2;
		if (sidebonds[3] != -1)
			this._dbonds[sidebonds[3]].saved =
				((mol.bonds.get(sidebonds[3]).begin == bond.end) == (parity == CisTrans.PARITY.CIS)) ? 2 : 1;
	}
	if (n2 > 0)
	{
		this._dbonds[sidebonds[0]].saved =
			(mol.bonds.get(sidebonds[0]).begin == bond.begin) ? 2 : 1;
		if (sidebonds[1] != -1)
			this._dbonds[sidebonds[1]].saved =
				(mol.bonds.get(sidebonds[1]).begin == bond.begin) ? 1 : 2;

		this._dbonds[sidebonds[2]].saved =
			((mol.bonds.get(sidebonds[2]).begin == bond.end) == (parity == CisTrans.PARITY.CIS)) ? 2 : 1;
		if (sidebonds[3] != -1)
			this._dbonds[sidebonds[3]].saved =
				((mol.bonds.get(sidebonds[3]).begin == bond.end) == (parity == CisTrans.PARITY.CIS)) ? 1 : 2;
	}

	return true;
};

Smiles.prototype._calcBondDirection = function (mol, idx, vprev)
{
	var ntouched;

	if (this._dbonds[idx].ctbond_beg == -1 && this._dbonds[idx].ctbond_end == -1)
		return 0;

	if (mol.bonds.get(idx).type != Struct.Bond.PATTERN.TYPE.SINGLE)
		throw new Error('internal: directed bond type ' + mol.bonds.get(idx).type);

	while (true)
	{
		ntouched = 0;
		this.cis_trans.each(function (bid, ct)
		{
			if (ct.parity != 0 && !this.isBondInRing(bid))
			{
				if (this._updateSideBonds(mol, bid))
					ntouched++;
			}
		}, this);
		if (ntouched == this._touched_cistransbonds)
			break;
		this._touched_cistransbonds = ntouched;
	}

	if (this._dbonds[idx].saved == 0)
	{
		if (vprev == mol.bonds.get(idx).begin)
			this._dbonds[idx].saved = 1;
		else
			this._dbonds[idx].saved = 2;
	}

	return this._dbonds[idx].saved;
};

Smiles.prototype._writeRadicals = function (mol)
{
	var marked = new Array(this._written_atoms.length);
	var i, j;

	for (i = 0; i < this._written_atoms.size(); i++)
	{
		if (marked[i])
			continue;

		var radical = mol.atoms.get(this._written_atoms[i]).radical;

		if (radical == 0)
			continue;

		if (this.comma)
			this.smiles += ',';
		else
		{
			this.smiles += ' |';
			this.comma = true;
		}

		if (radical == Struct.Atom.PATTERN.RADICAL.SINGLET)
			this.smiles += '^3:';
		else if (radical == Struct.Atom.PATTERN.RADICAL.DOUPLET)
			this.smiles += '^1:';
		else // RADICAL_TRIPLET
			this.smiles += '^4:';

		this.smiles += i;

		for (j = i + 1; j < this._written_atoms.length; j++)
			if (mol.atoms.get(this._written_atoms[j]).radical == radical)
			{
				marked[j] = true;
				this.smiles += ',' + j;
			}
	}
};

module.exports = {
	stringify: function (struct, options) {
		var opts = options || {};
		return new Smiles().saveMolecule(struct, opts.ignoreErrors);
	}
};