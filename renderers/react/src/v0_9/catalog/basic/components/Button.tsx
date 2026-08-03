/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import {createComponentImplementation} from '../../../adapter';
import {ButtonApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';
import styles from './Button.module.css';

export const Button = createComponentImplementation(ButtonApi, ({props, buildChild}) => {
  useBasicCatalogStyles();

  const uniqueId = React.useId();
  const descriptionId = `${uniqueId}-description`;
  const hasDescription = !!props.accessibility?.description;

  const hiddenStyle: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    border: 0,
  };

  const classes = [styles.button];
  if (props.variant === 'primary') {
    classes.push(styles.primary);
  } else if (props.variant === 'borderless') {
    classes.push(styles.borderless);
  }

  return (
    <>
      <button
        className={classes.join(' ')}
        onClick={props.action}
        disabled={props.isValid === false}
        aria-label={props.accessibility?.label}
        aria-describedby={hasDescription ? descriptionId : undefined}
      >
        {props.child ? buildChild(props.child) : null}
      </button>
      {hasDescription && (
        <span id={descriptionId} style={hiddenStyle}>
          {props.accessibility?.description}
        </span>
      )}
    </>
  );
});
