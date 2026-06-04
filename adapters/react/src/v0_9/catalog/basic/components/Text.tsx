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

import {createComponentImplementation} from '../../../adapter';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseLeafStyle, getWeightStyle, useBasicCatalogStyles} from '../utils';
import {useMarkdown} from '../hooks/useMarkdown';

// Import CSS Module
import styles from './Text.module.css';

/**
 * Wraps the plain text with appropriate Markdown syntax based on the requested variant.
 *
 * @param text The plain text to be wrapped.
 * @param variant The typography variant (e.g., 'h1', 'caption').
 * @returns The text wrapped in Markdown syntax.
 */
const handleVariant = (text: string, variant?: string): string => {
  switch (variant) {
    case 'h1':
      return `# ${text}`;
    case 'h2':
      return `## ${text}`;
    case 'h3':
      return `### ${text}`;
    case 'h4':
      return `#### ${text}`;
    case 'h5':
      return `##### ${text}`;
    case 'caption':
      return `*${text}*`;
    default:
      return text;
  }
};

export const Text = createComponentImplementation(TextApi, ({props}) => {
  useBasicCatalogStyles();
  const text = typeof props.text === 'string' ? props.text : String(props.text ?? '');
  const markdownText = handleVariant(text, props.variant);
  const renderedHtml = useMarkdown(markdownText);
  const style: React.CSSProperties = {
    ...getBaseLeafStyle(),
    ...getWeightStyle(props.weight),
  };

  const isCaption = props.variant === 'caption';
  const classes = [styles.a2uiText, isCaption ? styles.a2uiCaption : props.variant || 'body'];
  if (renderedHtml === null) {
    classes.push('no-markdown-renderer');
  }
  const contentProps =
    renderedHtml !== null
      ? {dangerouslySetInnerHTML: {__html: renderedHtml}}
      : {children: markdownText};

  if (isCaption) {
    return <span className={classes.join(' ')} style={style} {...contentProps} />;
  }
  return <div className={classes.join(' ')} style={style} {...contentProps} />;
});
