import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PLACES } from '../src/profile.ts';
import type { BrowserReceipt } from '../src/publish.ts';

interface Scenario { place: string; zoom: number; theme: string; pixelRatio: number }
interface Report { manifestSha256: string; offline: boolean; scenarios: Scenario[] }
export default class ReceiptReporter implements Reporter {
	private reports: Report[] = [];
	private receiptPath = path.resolve(process.env.PMTILES_BROWSER_RECEIPT ?? 'out/browser-receipt.json');
	onBegin() { rmSync(this.receiptPath, { force: true }); }
	onTestEnd(_test: TestCase, result: TestResult) {
		if (result.status !== 'passed') return;
		const attachment = result.attachments.find(item => item.name === 'pmtiles-scenarios');
		if (attachment?.body) this.reports.push(JSON.parse(attachment.body.toString('utf8')) as Report);
	}
	onEnd(result: FullResult) {
		if (result.status !== 'passed') return;
		const packageDir = path.resolve(process.env.PMTILES_PACKAGE_DIR ?? 'out/bucuresti-ilfov/20261106-v1');
		const manifestSha256 = createHash('sha256').update(readFileSync(path.join(packageDir, 'manifest.json'))).digest('hex');
		const expected = new Set<string>();
		for (const ratio of [1, 2]) for (const theme of ['light', 'dark']) for (const place of Object.keys(PLACES)) for (const zoom of [10, 15, 18]) expected.add(`${ratio}/${theme}/${place}/${zoom}`);
		const scenarios = this.reports.flatMap(report => report.scenarios);
		const actual = new Set(scenarios.map(scenario => `${scenario.pixelRatio}/${scenario.theme}/${scenario.place}/${scenario.zoom}`));
		if (this.reports.length !== 2 || this.reports.some(report => !report.offline || report.manifestSha256 !== manifestSha256) ||
			scenarios.length !== 84 || actual.size !== 84 || [...expected].some(key => !actual.has(key))) throw new Error('Refusing incomplete/mismatched browser receipt');
		const toolRevision = process.env.PMTILES_TOOL_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
		if (!/^[a-f0-9]{40}$/.test(toolRevision)) throw new Error('PMTILES_TOOL_REVISION must be a full Git SHA');
		const receipt: BrowserReceipt = { schemaVersion: 1, manifestSha256, toolRevision, passed: true, scenarios: 84,
			themes: ['light', 'dark'], pixelRatios: [1, 2], offline: true };
		mkdirSync(path.dirname(this.receiptPath), { recursive: true });
		writeFileSync(`${this.receiptPath}.partial`, `${JSON.stringify(receipt, null, 2)}\n`);
		renameSync(`${this.receiptPath}.partial`, this.receiptPath);
		console.log(`Browser receipt: ${this.receiptPath}`);
	}
}
