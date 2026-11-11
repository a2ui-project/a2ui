/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * An app that calls its functions through `a2ui:bindings`: `formatCurrency` from the basic
 * catalog, and `estimateTravelTime` from the fixture's agent function catalog, whose stops are
 * strings.
 */

export const BINDINGS_APP_SOURCE = `import { useEffect, useState } from "react";
import { Card, Stack, Text } from "a2ui";
import { estimateTravelTime, formatCurrency } from "a2ui:bindings";

export default function App() {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  useEffect(() => {
    estimateTravelTime({ stops: ["louvre", "orsay"] }).then(setMinutes);
    formatCurrency({ value: 42, currency: "USD" }).then(setPrice);
  }, []);
  return (
    <Card title="Bindings app">
      <Stack gap={1}>
        <Text>Minutes: <span data-testid="binding-minutes">{minutes ?? "…"}</span></Text>
        <Text>Price: <span data-testid="binding-price">{price}</span></Text>
      </Stack>
    </Card>
  );
}
`;
