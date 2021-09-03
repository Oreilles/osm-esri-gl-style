import * as fs from 'fs/promises';
import fetch from 'node-fetch';
import ora from 'ora';
import sources from './sources.js'

function fixLayerFont(layer) {
	const fonts = layer.layout?.['text-font'];
	if (fonts) {
		layer.layout['text-font'] = [fonts[0].replace(/.*(Regular|Bold|Italic)/, 'Open Sans $1')];
		const size = layer.layout['text-size'];
		if (typeof size == 'number') layer.layout['text-size'] += 3;
		else layer.layout['text-size'].stops?.forEach(stop => stop[1] += 3);
	}
}

async function parseVectorTileLayerUrl(url, id) {
	const style = await (await fetch(url)).json();
	const metadataUrl = style.sources.esri.url;
	const metadata = await (await fetch(metadataUrl)).json();
	for (const layer of style.layers) {
		layer.source = id
		fixLayerFont(layer);
	}
	style.sources[id] = {
		type: 'vector',
		scheme: 'xyz',
		format: metadata.tileInfo?.format || 'pbf',
		tilejson: metadata.tilejson || '2.0.0',
		maxzoom: metadata.maxzoom || 22,
		tiles: [
				style.sources.esri.url + '/' + metadata.tiles[0]
		],
		description: metadata.description,
		name: metadata.name
	};
	style.glyphs = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';
	delete style.sources.esri;
	return style;
}

async function parseArcGISTiledMapServiceLayerUrl(url, id) {
	const metadata = await (await fetch(url + '?f=json')).json();
	return {
		version: 8,
		sources: {
			[id]: {
				type: 'raster',
				tiles: [url + '/tile/{z}/{y}/{x}'],
				tileSize: metadata.tileInfo.rows,
				attribution: metadata.copyrightText,
				minzoom: metadata.minScale || 0,
				maxzoom: metadata.maxScale || 22,
			}
		},
		layers: [{
			id: id,
			type: 'raster',
			source: id,
		}]
	}
}

async function parseBasemap(id) {
	const url = `https://www.arcgis.com/sharing/rest/content/items/${id}/data?f=json`;

	let style = { sources: {}, layers: [] };
	const { baseMapLayers } = (await (await fetch(url)).json())?.baseMap;
	if (!baseMapLayers)
			return style;

	let parsed;
	for (const layer of baseMapLayers) {
		let { id, layerType, styleUrl, url } = layer;
		if (layerType == 'VectorTileLayer') {
			parsed = await parseVectorTileLayerUrl(styleUrl, id);
		} else
		if (layerType == 'ArcGISTiledMapServiceLayer') {
			parsed = await parseArcGISTiledMapServiceLayerUrl(url, id);
		}
		let { sources, layers, ...rest } = parsed;
		Object.assign(style, rest || {});
		Object.assign(style.sources, sources);
		style.layers.push(...layers);
	}
	return style;
}

async function main() {
	await fs.rm('styles', { force: true, recursive: true });
	await fs.mkdir('styles');

	for (const { id, title } of sources) {
		const spinner = ora(`Generating style ${title}`).start();
		const style = await parseBasemap(id);
		await fs.writeFile(`styles/${title}.json`, JSON.stringify(style, null, 4));
		spinner.succeed();
	}
}

(async () => main())()
