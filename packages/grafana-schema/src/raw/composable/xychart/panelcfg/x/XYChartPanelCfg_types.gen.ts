// Code generated - EDITING IS FUTILE. DO NOT EDIT.
//
// Generated by:
//     public/app/plugins/gen.go
// Using jennies:
//     TSTypesJenny
//     LatestMajorsOrXJenny
//     PluginEachMajorJenny
//
// Run 'make gen-cue' from repository root to regenerate.

import * as common from '@grafana/schema';

export const pluginVersion = "10.1.3";

export enum SeriesMapping {
  Auto = 'auto',
  Manual = 'manual',
}

export enum ScatterShow {
  Lines = 'lines',
  Points = 'points',
  PointsAndLines = 'points+lines',
}

export interface XYDimensionConfig {
  exclude?: Array<string>;
  frame: number;
  x?: string;
}

export const defaultXYDimensionConfig: Partial<XYDimensionConfig> = {
  exclude: [],
};

export interface FieldConfig extends common.HideableFieldConfig, common.AxisConfig {
  label?: common.VisibilityMode;
  labelValue?: common.TextDimensionConfig;
  lineColor?: common.ColorDimensionConfig;
  lineStyle?: common.LineStyle;
  lineWidth?: number;
  pointColor?: common.ColorDimensionConfig;
  pointSize?: common.ScaleDimensionConfig;
  show?: ScatterShow;
}

export const defaultFieldConfig: Partial<FieldConfig> = {
  label: common.VisibilityMode.Auto,
  show: ScatterShow.Points,
};

export interface ScatterSeriesConfig extends FieldConfig {
  name?: string;
  x?: string;
  y?: string;
}

export interface Options extends common.OptionsWithLegend, common.OptionsWithTooltip {
  dims: XYDimensionConfig;
  series: Array<ScatterSeriesConfig>;
  seriesMapping?: SeriesMapping;
}

export const defaultOptions: Partial<Options> = {
  series: [],
};
