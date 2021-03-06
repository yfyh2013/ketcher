import { h } from 'preact';

function Icon({ name, ...props }) {
	return (
		<svg {...props}>
			<use xlinkHref={`#icon-${name}`} />
		</svg>
	);
}
export default Icon;
