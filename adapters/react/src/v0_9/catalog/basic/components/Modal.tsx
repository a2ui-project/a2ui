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

import {useState} from 'react';
import {createComponentImplementation} from '../../../adapter';
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const Modal = createComponentImplementation(ModalApi, ({props, buildChild}) => {
  useBasicCatalogStyles();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div onClick={() => setIsOpen(true)} style={{display: 'inline-block'}}>
        {props.trigger ? buildChild(props.trigger) : null}
      </div>
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'var(--a2ui-modal-overlay-color, rgba(0, 0, 0, 0.5))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setIsOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--a2ui-color-surface, #fff)',
              padding: 'var(--a2ui-modal-padding, var(--a2ui-spacing-l, 24px))',
              borderRadius: 'var(--a2ui-modal-border-radius, var(--a2ui-border-radius, 8px))',
              maxWidth: '90%',
              maxHeight: '90%',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              color: 'var(--a2ui-color-on-surface, inherit)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{display: 'flex', justifyContent: 'flex-end'}}>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: 'var(--a2ui-font-size-xl, 1.5rem)',
                  cursor: 'pointer',
                  padding: 'var(--a2ui-spacing-xs, 4px)',
                  color: 'var(--a2ui-color-on-surface, inherit)',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{flex: 1}}>{props.content ? buildChild(props.content) : null}</div>
          </div>
        </div>
      )}
    </>
  );
});
