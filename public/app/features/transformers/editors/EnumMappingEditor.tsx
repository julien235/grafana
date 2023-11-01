import { css } from '@emotion/css';
import { isEqual } from 'lodash';
import React, { useEffect, useState } from 'react';
import { DragDropContext, Droppable, DropResult } from 'react-beautiful-dnd';

import { DataFrame, EnumFieldConfig, GrafanaTheme2 } from '@grafana/data';
import { ConvertFieldTypeTransformerOptions } from '@grafana/data/src/transformations/transformers/convertFieldType';
import { Button, HorizontalGroup, InlineFieldRow, useStyles2, VerticalGroup } from '@grafana/ui';

import EnumMappingRow from './EnumMappingRow';

type EnumMappingEditorProps = {
  input: DataFrame[];
  options: ConvertFieldTypeTransformerOptions;
  convertFieldTransformIndex: number;
  onChange: (options: ConvertFieldTypeTransformerOptions) => void;
};

export const EnumMappingEditor = ({ input, options, convertFieldTransformIndex, onChange }: EnumMappingEditorProps) => {
  const styles = useStyles2(getStyles);

  const [enumRows, updateEnumRows] = useState<string[]>(
    options.conversions[convertFieldTransformIndex].enumConfig?.text ?? []
  );

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }

    // Necessary to match the order of enum values to the order shown in the visualization
    const mappedSourceIndex = enumRows.length - result.source.index - 1;
    const mappedDestinationIndex = enumRows.length - result.destination.index - 1;

    const copy = [...enumRows];
    const element = copy[mappedSourceIndex];
    copy.splice(mappedSourceIndex, 1);
    copy.splice(mappedDestinationIndex, 0, element);
    updateEnumRows(copy);
  };

  useEffect(() => {
    // Generate enum values from scratch when none exist in save model
    // TODO: consider case when changing target field
    if (!options.conversions[convertFieldTransformIndex].enumConfig?.text?.length && input.length) {
      generateEnumValues();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const generateEnumValues = () => {
    // Loop through all fields in provided data frames to find the target field
    const targetField = input
      .flatMap((inputItem) => inputItem?.fields ?? [])
      .find((field) => field.name === options.conversions[convertFieldTransformIndex].targetField);

    if (!targetField) {
      return;
    }

    // create set of values for enum without any duplicate values (from targetField.values)
    // maybe this should run automatically on first render?
    const enumValues = new Set(targetField?.values);

    if (enumRows.length > 0 && !isEqual(enumRows, Array.from(enumValues))) {
      const confirmed = window.confirm(
        'This action will overwrite the existing configuration. Are you sure you want to continue?'
      );
      if (!confirmed) {
        return;
      }
    }

    updateEnumRows([...enumValues]);
  };

  const onChangeEnumMapping = (index: number, enumRow: string) => {
    const newList = [...enumRows];
    newList.splice(index, 1, enumRow);
    updateEnumRows(newList);
  };

  const onRemoveEnumRow = (index: number) => {
    const newList = [...enumRows];
    newList.splice(index, 1);
    updateEnumRows(newList);
  };

  const onAddEnumRow = () => {
    updateEnumRows(['', ...enumRows]);
  };

  const onChangeEnumValue = (index: number, value: string) => {
    if (enumRows.includes(value)) {
      return;
    }

    onChangeEnumMapping(index, value);
  };

  useEffect(() => {
    const applyEnumConfig = () => {
      const textValues = enumRows.map((value) => value);
      const conversions = options.conversions;
      const enumConfig: EnumFieldConfig = { text: textValues };
      conversions[convertFieldTransformIndex] = { ...conversions[convertFieldTransformIndex], enumConfig };

      onChange({
        ...options,
        conversions: conversions,
      });
    };

    applyEnumConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertFieldTransformIndex, enumRows]);

  const checkIsEnumUniqueValue = (value: string) => {
    return enumRows.includes(value);
  };

  return (
    <InlineFieldRow>
      <HorizontalGroup>
        <Button size="sm" icon="plus" onClick={() => generateEnumValues()} className={styles.button}>
          Generate enum values from data
        </Button>
        <Button size="sm" icon="plus" onClick={() => onAddEnumRow()} className={styles.button}>
          Add enum value
        </Button>
      </HorizontalGroup>

      <VerticalGroup>
        <table className={styles.compactTable}>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="sortable-enum-config-mappings" direction="vertical">
              {(provided) => (
                <tbody ref={provided.innerRef} {...provided.droppableProps}>
                  {[...enumRows].reverse().map((value: string, index: number) => {
                    // Reverse the order of the enum values to match the order of the enum values in the table to the order in the visualization
                    const mappedIndex = enumRows.length - index - 1;
                    return (
                      <EnumMappingRow
                        key={`${convertFieldTransformIndex}/${value}`}
                        convertFieldTransformIndex={convertFieldTransformIndex}
                        value={value}
                        index={index}
                        mappedIndex={mappedIndex}
                        onChangeEnumValue={onChangeEnumValue}
                        onRemoveEnumRow={onRemoveEnumRow}
                        checkIsEnumUniqueValue={checkIsEnumUniqueValue}
                      />
                    );
                  })}
                  {provided.placeholder}
                </tbody>
              )}
            </Droppable>
          </DragDropContext>
        </table>
      </VerticalGroup>
    </InlineFieldRow>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  compactTable: css({
    'tbody td': {
      padding: theme.spacing(0.5),
    },
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(2),
  }),
  button: css({
    marginTop: theme.spacing(1),
  }),
});
