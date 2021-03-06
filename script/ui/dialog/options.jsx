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

import { h } from 'preact';
import { connect } from 'preact-redux';
import { updateFormState, setDefaultSettings } from '../state/form';
import { saveSettings } from '../state/options';

import settingsSchema from '../data/options-schema';
import Form, { Field } from '../component/form';
import { storage } from '../utils';

import Dialog from '../component/dialog';
import Accordion from '../component/accordion';
import SystemFonts from '../component/systemfonts';
import SaveButton from '../component/savebutton';
import OpenButton from '../component/openbutton';
import MeasureInput from '../component/measure-input';

function Settings(props) {
	const { initState, formState, server, onOpenFile, onReset, appOpts, ...prop } = props;
	const tabs = ['Rendering customization options', 'Atoms', 'Bonds', 'Server', '3D Viewer', 'Options for debugging'];
	const activeTabs = { 0: true, 1: false, 2: false, 3: false, 4: false, 5: false };

	return (
		<Dialog
			title="Settings"
			className="settings"
			result={() => formState.result}
			valid={() => formState.valid}
			params={prop}
			buttons={[
				<OpenButton server={server} onLoad={onOpenFile}>
						Open From File…
				</OpenButton>,
				<SaveButton data={JSON.stringify(formState.result)} filename="ketcher-settings">
						Save To File…
				</SaveButton>,
				<button onClick={onReset}>Reset</button>,
				'Cancel', 'OK'
			]}
		>
			<Form schema={settingsSchema} init={initState} {...formState}>
				<Accordion className="accordion" captions={tabs} active={activeTabs}>
					<fieldset className="render">
						<Field name="resetToSelect" />
						<Field name="rotationStep" />
						<SelectCheckbox name="showValenceWarnings" />
						<SelectCheckbox name="atomColoring" />
						<SelectCheckbox name="hideChiralFlag" />
						<Field name="font" component={SystemFonts} />
						<FieldMeasure name="fontsz" />
						<FieldMeasure name="fontszsub" />
					</fieldset>
					<fieldset className="atoms">
						<SelectCheckbox name="carbonExplicitly" />
						<SelectCheckbox name="showCharge" />
						<SelectCheckbox name="showValence" />
						<Field name="showHydrogenLabels" />
					</fieldset>
					<fieldset className="bonds">
						<SelectCheckbox name="aromaticCircle" />
						<FieldMeasure name="doubleBondWidth" />
						<FieldMeasure name="bondThickness" />
						<FieldMeasure name="stereoBondWidth" />
					</fieldset>
					<fieldset className="server" disabled={!appOpts.server}>
						<SelectCheckbox name="smart-layout" />
						<SelectCheckbox name="ignore-stereochemistry-errors" />
						<SelectCheckbox name="mass-skip-error-on-pseudoatoms" />
						<SelectCheckbox name="gross-formula-add-rsites" />
					</fieldset>
					<fieldset className="3dView" disabled={!appOpts.miewPath}>
						<Field name="miewMode" />
						<Field name="miewTheme" />
						<Field name="miewAtomLabel" />
					</fieldset>
					<fieldset className="debug">
						<SelectCheckbox name="showAtomIds" />
						<SelectCheckbox name="showBondIds" />
						<SelectCheckbox name="showHalfBondIds" />
						<SelectCheckbox name="showLoopIds" />
					</fieldset>
				</Accordion>
				{ !storage.isAvailable() ? <div className="warning">{storage.warningMessage}</div> : null }
			</Form>
		</Dialog>
	);
}

function SelectCheckbox(props, { schema }) {
	const desc = {
		title: schema.properties[props.name].title,
		enum: [true, false],
		enumNames: ['on', 'off']
	};
	return <Field schema={desc} {...props} />;
}

function FieldMeasure(props, { schema }) {
	return <Field schema={schema.properties[props.name]} component={MeasureInput} {...props} />;
}

export default connect(store => ({
	appOpts: store.options.app,
	initState: store.options.settings,
	formState: store.modal.form
}), (dispatch, props) => ({
	onOpenFile: (newOpts) => {
		try {
			dispatch(updateFormState({ result: JSON.parse(newOpts) }));
		} catch (ex) {
			console.info('Bad file');
		}
	},
	onReset: () => dispatch(setDefaultSettings()),
	onOk: (res) => {
		dispatch(saveSettings(res));
		props.onOk(res);
	}
}))(Settings);
