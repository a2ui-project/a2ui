# A2UI Vertical strategy generation examples

This document provides concrete end-to-end examples of A2UI Vertical format generations, showing the model prompt contract, emitted DSL text, and compiled standard A2UI wire protocol payloads.

---

## Example 1: Standalone Flight Status Card

### Model output:

```text
Here is the current status of United flight UA 421:

<a2ui>
FlightStatusCard(airline="United Airlines", flightNumber="UA 421", origin="SFO", destination="ORD", departureTime="10:45 AM", arrivalTime="4:30 PM", status="On Time", gate="B12", baggageClaim="Carousel 4")
</a2ui>
```

### Compiled A2UI v0.9.1 payload:

```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "FlightStatusCard",
          "airline": "United Airlines",
          "flightNumber": "UA 421",
          "origin": "SFO",
          "destination": "ORD",
          "departureTime": "10:45 AM",
          "arrivalTime": "4:30 PM",
          "status": "On Time",
          "gate": "B12",
          "baggageClaim": "Carousel 4"
        }
      ]
    }
  }
]
```

---

## Example 2: Multi-Surface Streaming Dashboard

When an agent produces multiple related cards, each component is emitted on its own surface without container nesting.

### Model output:

```text
I've pulled up your portfolio stock quote along with the current weather for Seattle:

<a2ui>
StockTicker(symbol="GOOGL", price=182.50, change="+1.25%", volume=24500000)
WeatherWidget(city="Seattle", temperature=58, condition="rainy", high=62, low=50, humidity=82)
</a2ui>
```

### Compiled A2UI v0.9.1 payload:

```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "StockTicker",
          "symbol": "GOOGL",
          "price": 182.5,
          "change": "+1.25%",
          "volume": 24500000
        }
      ]
    }
  },
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main_1",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "main_1",
      "components": [
        {
          "id": "root",
          "component": "WeatherWidget",
          "city": "Seattle",
          "temperature": 58,
          "condition": "rainy",
          "high": 62,
          "low": 50,
          "humidity": 82
        }
      ]
    }
  }
]
```

---

## Example 3: Dynamic Data Binding & Interactive Actions

### Model output:

```text
<a2ui>
UserProfileCard(name=$/session/user/name, email=$/session/user/email, role="Administrator", onEdit=Event("openEditProfile", userId=$/session/user/id))
</a2ui>
```

### Compiled A2UI v1.0 payload:

```json
[
  {
    "version": "v1.0",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v1.0",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "UserProfileCard",
          "name": {
            "path": "/session/user/name"
          },
          "email": {
            "path": "/session/user/email"
          },
          "role": "Administrator",
          "onEdit": {
            "event": {
              "name": "openEditProfile",
              "context": {
                "userId": {
                  "path": "/session/user/id"
                }
              }
            }
          }
        }
      ]
    }
  }
]
```

---

## Example 4: Automatic Schema Coercion of Quoted Primitives

When small models serialize numbers or booleans inside quotation marks or append percentage signs, Vertical automatically inspects the catalog and coerces them into expected types.

### Model output:

```text
<a2ui>
MetricsTile(label="Monthly Recurring Revenue", value="$1.42M", changePercent="+10.9%", trend="up", period="vs prior month")
ProductCard(title="Wireless Headphones", price="329.99", inStock="true", rating="4.8")
</a2ui>
```

### Compiled Component Output (`updateComponents`):

Notice that:

- `changePercent` is coerced from `"+10.9%"` to `10.9` (float).
- `price` is coerced from `"329.99"` to `329.99` (float).
- `inStock` is coerced from `"true"` to `true` (boolean).
- `rating` is coerced from `"4.8"` to `4.8` (float).

```json
[
  {
    "id": "root",
    "component": "MetricsTile",
    "label": "Monthly Recurring Revenue",
    "value": "$1.42M",
    "changePercent": 10.9,
    "trend": "up",
    "period": "vs prior month"
  },
  {
    "id": "root",
    "component": "ProductCard",
    "title": "Wireless Headphones",
    "price": 329.99,
    "inStock": true,
    "rating": 4.8
  }
]
```
