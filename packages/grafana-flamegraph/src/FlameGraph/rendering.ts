import uFuzzy from '@leeoniya/ufuzzy';
import { RefObject, useEffect, useMemo, useState } from 'react';
import color from 'tinycolor2';

import { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

import {
  BAR_BORDER_WIDTH,
  BAR_TEXT_PADDING_LEFT,
  MUTE_THRESHOLD,
  HIDE_THRESHOLD,
  LABEL_THRESHOLD,
  PIXELS_PER_LEVEL,
  GROUP_STRIP_WIDTH,
  GROUP_STRIP_PADDING,
  GROUP_STRIP_MARGIN_LEFT,
  GROUP_TEXT_OFFSET,
} from '../constants';
import { ClickedItemData, ColorScheme, ColorSchemeDiff, TextAlign } from '../types';

import { getBarColorByDiff, getBarColorByPackage, getBarColorByValue } from './colors';
import { CollapseConfig, CollapsedMap, FlameGraphDataContainer, LevelItem } from './dataTransform';

const ufuzzy = new uFuzzy();

type RenderOptions = {
  canvasRef: RefObject<HTMLCanvasElement>;
  data: FlameGraphDataContainer;
  root: LevelItem;
  direction: 'children' | 'parents';

  // Depth in number of levels
  depth: number;
  wrapperWidth: number;

  // If we are rendering only zoomed in part of the graph.
  rangeMin: number;
  rangeMax: number;

  search: string;
  textAlign: TextAlign;

  // Total ticks that will be used for sizing
  totalViewTicks: number;
  // Total ticks that will be used for computing colors as some color scheme (like in diff view) should not be affected
  // by sandwich or focus view.
  totalColorTicks: number;
  // Total ticks used to compute the diff colors
  totalTicksRight: number | undefined;
  colorScheme: ColorScheme | ColorSchemeDiff;
  focusedItemData?: ClickedItemData;
  collapsedMap: CollapsedMap;
};

export function useFlameRender(options: RenderOptions) {
  const {
    canvasRef,
    data,
    root,
    depth,
    direction,
    wrapperWidth,
    rangeMin,
    rangeMax,
    search,
    textAlign,
    totalViewTicks,
    totalColorTicks,
    totalTicksRight,
    colorScheme,
    focusedItemData,
    collapsedMap,
  } = options;
  const foundLabels = useFoundLabels(search, data);
  const ctx = useSetupCanvas(canvasRef, wrapperWidth, depth);
  const theme = useTheme2();

  // There is a bit of dependency injections here that does not add readability, mainly to prevent recomputing some
  // common stuff for all the nodes in the graph when only once is enough. perf/readability tradeoff.

  const getBarColor = useColorFunction(
    totalColorTicks,
    totalTicksRight,
    colorScheme,
    theme,
    rangeMin,
    rangeMax,
    foundLabels,
    focusedItemData ? focusedItemData.item.level : 0
  );
  const renderFunc = useRenderFunc(ctx, data, getBarColor, textAlign, collapsedMap);

  useEffect(() => {
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    walkTree(root, direction, data, totalViewTicks, rangeMin, rangeMax, wrapperWidth, collapsedMap, renderFunc);
  }, [ctx, data, root, wrapperWidth, rangeMin, rangeMax, totalViewTicks, direction, renderFunc, collapsedMap]);
}

type RenderFunc = (
  item: LevelItem,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  // muted means the width is too small, and we just show gray rectangle.
  muted: boolean
) => void;

function useRenderFunc(
  ctx: CanvasRenderingContext2D | undefined,
  data: FlameGraphDataContainer,
  getBarColor: (item: LevelItem, label: string, muted: boolean) => string,
  textAlign: TextAlign,
  collapsedMap: CollapsedMap
): RenderFunc {
  return useMemo(() => {
    if (!ctx) {
      return () => {};
    }

    return (item, x, y, width, height, label, muted) => {
      ctx.beginPath();
      ctx.rect(x + (muted ? 0 : BAR_BORDER_WIDTH), y, width, height);
      ctx.fillStyle = getBarColor(item, label, muted);

      const collapsedItemConfig = collapsedMap.get(item);
      if (collapsedItemConfig && collapsedItemConfig.collapsed) {
        const numberOfCollapsedItems = collapsedItemConfig.items.length;
        label = `(${numberOfCollapsedItems}) ` + label;
      }

      if (muted) {
        // Only fill the muted rects
        ctx.fill();
      } else {
        ctx.stroke();
        ctx.fill();

        if (collapsedItemConfig) {
          if (width >= LABEL_THRESHOLD) {
            renderLabel(
              ctx,
              data,
              label,
              item,
              width,
              textAlign === 'left' ? x + GROUP_STRIP_MARGIN_LEFT + GROUP_TEXT_OFFSET : x,
              y,
              textAlign
            );

            renderGroupingStrip(ctx, x, y, height, item, collapsedItemConfig);
          }
        } else {
          if (width >= LABEL_THRESHOLD) {
            renderLabel(ctx, data, label, item, width, x, y, textAlign);
          }
        }
      }
    };
  }, [ctx, getBarColor, textAlign, data, collapsedMap]);
}

/**
 * Render small strip on the left side of the bar to indicate that this item is part of a group that can be collapsed.
 * @param ctx
 * @param x
 * @param y
 * @param height
 * @param item
 * @param collapsedItemConfig
 */
function renderGroupingStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  item: LevelItem,
  collapsedItemConfig: CollapseConfig
) {
  const groupStripX = x + GROUP_STRIP_MARGIN_LEFT;

  // This is to mask the label in case we align it right to left.
  ctx.beginPath();
  ctx.rect(x, y, groupStripX - x + GROUP_STRIP_WIDTH + GROUP_STRIP_PADDING, height);
  ctx.fill();

  // For item in a group that can be collapsed, we draw a small strip to mark them. On the items that are at the
  // start or and end of a group we draw just half the strip so 2 groups next to each other are separated
  // visually.
  ctx.beginPath();
  if (collapsedItemConfig.collapsed) {
    ctx.rect(groupStripX, y + height / 4, GROUP_STRIP_WIDTH, height / 2);
  } else {
    if (collapsedItemConfig.items[0] === item) {
      // Top item
      ctx.rect(groupStripX, y + height / 2, GROUP_STRIP_WIDTH, height / 2);
    } else if (collapsedItemConfig.items[collapsedItemConfig.items.length - 1] === item) {
      // Bottom item
      ctx.rect(groupStripX, y, GROUP_STRIP_WIDTH, height / 2);
    } else {
      ctx.rect(groupStripX, y, GROUP_STRIP_WIDTH, height);
    }
  }

  ctx.fillStyle = '#666';
  ctx.fill();
}

/**
 * Exported for testing don't use directly
 * Walks the tree and computes coordinates, dimensions and other data needed for rendering. For each item in the tree
 * it defers the rendering to the renderFunc.
 */
export function walkTree(
  root: LevelItem,
  // In sandwich view we use parents direction to show all callers.
  direction: 'children' | 'parents',
  data: FlameGraphDataContainer,
  totalViewTicks: number,
  rangeMin: number,
  rangeMax: number,
  wrapperWidth: number,
  collapsedMap: CollapsedMap,
  renderFunc: RenderFunc
) {
  // The levelOffset here is to keep track if items that we don't render because they are collapsed into single row.
  // That means we have to render next items with an offset of some rows up in the stack.
  const stack: Array<{ item: LevelItem; levelOffset: number }> = [];
  stack.push({ item: root, levelOffset: 0 });

  const pixelsPerTick = (wrapperWidth * window.devicePixelRatio) / totalViewTicks / (rangeMax - rangeMin);
  let collapsedItemRendered: LevelItem | undefined = undefined;

  while (stack.length > 0) {
    const { item, levelOffset } = stack.shift()!;
    let curBarTicks = item.value;
    const muted = curBarTicks * pixelsPerTick <= MUTE_THRESHOLD;
    const width = curBarTicks * pixelsPerTick - (muted ? 0 : BAR_BORDER_WIDTH * 2);
    const height = PIXELS_PER_LEVEL;

    if (width < HIDE_THRESHOLD) {
      // We don't render nor it's children
      continue;
    }

    let offsetModifier = 0;
    let skipRender = false;
    const collapsedItemConfig = collapsedMap.get(item);
    const isCollapsedItem = collapsedItemConfig && collapsedItemConfig.collapsed;

    if (isCollapsedItem) {
      if (collapsedItemRendered === collapsedItemConfig.items[0]) {
        offsetModifier = direction === 'children' ? -1 : +1;
        skipRender = true;
      } else {
        // This is a case where we have another collapsed group right after different collapsed group, so we need to
        // reset.
        collapsedItemRendered = undefined;
      }
    } else {
      collapsedItemRendered = undefined;
    }

    if (!skipRender) {
      const barX = getBarX(item.start, totalViewTicks, rangeMin, pixelsPerTick);
      const barY = (item.level + levelOffset) * PIXELS_PER_LEVEL;

      let label = data.getLabel(item.itemIndexes[0]);
      if (isCollapsedItem) {
        collapsedItemRendered = item;
      }

      renderFunc(item, barX, barY, width, height, label, muted);
    }

    const nextList = direction === 'children' ? item.children : item.parents;
    if (nextList) {
      stack.unshift(...nextList.map((c) => ({ item: c, levelOffset: levelOffset + offsetModifier })));
    }
  }
}

/**
 * Based on the search string it does a fuzzy search over all the unique labels so we can highlight them later.
 */
function useFoundLabels(search: string | undefined, data: FlameGraphDataContainer): Set<string> | undefined {
  return useMemo(() => {
    if (search) {
      const foundLabels = new Set<string>();
      let idxs = ufuzzy.filter(data.getUniqueLabels(), search);

      if (idxs) {
        for (let idx of idxs) {
          foundLabels.add(data.getUniqueLabels()[idx]);
        }
      }

      return foundLabels;
    }
    // In this case undefined means there was no search so no attempt to highlighting anything should be made.
    return undefined;
  }, [search, data]);
}

function useColorFunction(
  totalTicks: number,
  totalTicksRight: number | undefined,
  colorScheme: ColorScheme | ColorSchemeDiff,
  theme: GrafanaTheme2,
  rangeMin: number,
  rangeMax: number,
  foundNames: Set<string> | undefined,
  topLevel: number
) {
  return useMemo(() => {
    // We use the same color for all muted bars so let's do it just once and reuse the result in the closure of the
    // returned function.
    const barMutedColor = color(theme.colors.background.secondary);
    const barMutedColorHex = theme.isLight
      ? barMutedColor.darken(10).toHexString()
      : barMutedColor.lighten(10).toHexString();

    return function getColor(item: LevelItem, label: string, muted: boolean) {
      // If collapsed and no search we can quickly return the muted color
      if (muted && !foundNames) {
        // Collapsed are always grayed
        return barMutedColorHex;
      }

      const barColor =
        item.valueRight !== undefined &&
        (colorScheme === ColorSchemeDiff.Default || colorScheme === ColorSchemeDiff.DiffColorBlind)
          ? getBarColorByDiff(item.value, item.valueRight!, totalTicks, totalTicksRight!, colorScheme)
          : colorScheme === ColorScheme.ValueBased
          ? getBarColorByValue(item.value, totalTicks, rangeMin, rangeMax)
          : getBarColorByPackage(label, theme);

      if (foundNames) {
        // Means we are searching, we use color for matches and gray the rest
        return foundNames.has(label) ? barColor.toHslString() : barMutedColorHex;
      }

      // Mute if we are above the focused symbol
      return item.level > topLevel - 1 ? barColor.toHslString() : barColor.lighten(15).toHslString();
    };
  }, [totalTicks, totalTicksRight, colorScheme, theme, rangeMin, rangeMax, foundNames, topLevel]);
}

function useSetupCanvas(canvasRef: RefObject<HTMLCanvasElement>, wrapperWidth: number, numberOfLevels: number) {
  const [ctx, setCtx] = useState<CanvasRenderingContext2D>();

  useEffect(() => {
    if (!(numberOfLevels && canvasRef.current)) {
      return;
    }
    const ctx = canvasRef.current.getContext('2d')!;

    const height = PIXELS_PER_LEVEL * numberOfLevels;
    canvasRef.current.width = Math.round(wrapperWidth * window.devicePixelRatio);
    canvasRef.current.height = Math.round(height);
    canvasRef.current.style.width = `${wrapperWidth}px`;
    canvasRef.current.style.height = `${height / window.devicePixelRatio}px`;

    ctx.textBaseline = 'middle';
    ctx.font = 12 * window.devicePixelRatio + 'px monospace';
    ctx.strokeStyle = 'white';
    setCtx(ctx);
  }, [canvasRef, setCtx, wrapperWidth, numberOfLevels]);
  return ctx;
}

// Renders a text inside the node rectangle. It allows setting alignment of the text left or right which takes effect
// when text is too long to fit in the rectangle.
function renderLabel(
  ctx: CanvasRenderingContext2D,
  data: FlameGraphDataContainer,
  label: string,
  item: LevelItem,
  width: number,
  x: number,
  y: number,
  textAlign: TextAlign
) {
  ctx.save();
  ctx.clip(); // so text does not overflow
  ctx.fillStyle = '#222';

  const displayValue = data.valueDisplayProcessor(item.value);
  const unit = displayValue.suffix ? displayValue.text + displayValue.suffix : displayValue.text;

  // We only measure name here instead of full label because of how we deal with the units and aligning later.
  const measure = ctx.measureText(label);
  const spaceForTextInRect = width - BAR_TEXT_PADDING_LEFT;

  let fullLabel = `${label} (${unit})`;
  let labelX = Math.max(x, 0) + BAR_TEXT_PADDING_LEFT;

  // We use the desired alignment only if there is not enough space for the text, otherwise we keep left alignment as
  // that will already show full text.
  if (measure.width > spaceForTextInRect) {
    ctx.textAlign = textAlign;
    // If aligned to the right we don't want to take the space with the unit label as the assumption is user wants to
    // mainly see the name. This also reflects how pyro/flamegraph works.
    if (textAlign === 'right') {
      fullLabel = label;
      labelX = x + width - BAR_TEXT_PADDING_LEFT;
    }
  }

  ctx.fillText(fullLabel, labelX, y + PIXELS_PER_LEVEL / 2 + 2);
  ctx.restore();
}

/**
 * Returns the X position of the bar. totalTicks * rangeMin is to adjust for any current zoom. So if we zoom to a
 * section of the graph we align and shift the X coordinates accordingly.
 * @param offset
 * @param totalTicks
 * @param rangeMin
 * @param pixelsPerTick
 */
export function getBarX(offset: number, totalTicks: number, rangeMin: number, pixelsPerTick: number) {
  return (offset - totalTicks * rangeMin) * pixelsPerTick;
}
