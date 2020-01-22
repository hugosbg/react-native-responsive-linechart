import spline from "cubic-spline";
import deepmerge from "deepmerge";
import React, { Component } from "react";
import { View, PanResponder, ScrollView, Dimensions, StyleSheet, Text as RText } from "react-native";
import memoizeOne from "memoize-one";
import _ from "lodash";
import Svg, { G, Polyline, Rect, Text, Line, Polygon, LinearGradient, Defs, Stop, Circle } from "react-native-svg";

class LineChart extends Component {
    constructor(props) {
        super(props);
        this.state = {
            dimensions: undefined,
            tooltipIndex: undefined,
            isInitialized: false,
        };

        this.scrollRef = React.createRef();

        // Memoize data calculations for rendering
        this.recalculate = memoizeOne(this.recalculate);

        // For tooltips to work we need to get funky with the PanResponder.
        // Capturing touch and move events to calculate tooltip index
        if (_.get(props.config, "tooltip.visible", false) && props.config.interpolation !== "spline") {
            this._panResponder = PanResponder.create({
                onMoveShouldSetPanResponder: () => true,
                onPanResponderGrant: this.handleTouchEvent,
                onPanResponderMove: this.handleTouchEvent,
                onStartShouldSetPanResponder: this.handleTouchEvent
            });
        }
    }

    handleTouchEvent = (evt, gestureState) => {
        const xTouch = evt.nativeEvent.locationX - this.gridOffset.x;
        if (this.state.dimensions && this.points) {
            const idx = Math.round((xTouch / this.gridSize.width) * (this.props.data.length - 1));
            if (this.state.tooltipIndex != idx) {
                if (idx >= 0 && idx <= this.props.data.length - 1) {
                    this.setState({ tooltipIndex: idx }, () => {
                        const dataValue = this.props.data[idx];
                        this.props.onPress(dataValue, idx);
                    });
                } else {
                    this.setState({ tooltipIndex: undefined });
                }
            }
        }
        return true;
    };

    recalculate(dimensions, data, config) {
        if (!dimensions || data.length === 0) {
            return;
        }

        const { width, height } = dimensions;
        const mergedConfig = deepmerge(defaultConfig, config);
        const { grid, line, area, yAxis, xAxis, insetX, insetY, interpolation, backgroundColor } = mergedConfig;

        this.highestDataPoint = Math.max(...data);
        this.lowestDataPoint = Math.min(...data, 0);
        this.dataRange = this.highestDataPoint - this.lowestDataPoint;

        if (!config.grid || !config.grid.stepSize) {
            // default grid
            if (this.dataRange === 0) {
                //edge case for 1 value or multiple times the same value
                grid.stepSize = 1.0;
                this.lowestYLabel = this.lowestDataPoint - 2;
                this.highestYLabel = this.highestDataPoint + 3;
            } else {
                grid.stepSize = this.dataRange / 6.0;
                this.lowestYLabel = (Math.floor(this.lowestDataPoint / grid.stepSize) - 1) * grid.stepSize;
                this.highestYLabel = (Math.ceil(this.highestDataPoint / grid.stepSize) + 1) * grid.stepSize;
            }
        } else {
            // grid specified in config
            this.lowestYLabel = (Math.floor(this.lowestDataPoint / grid.stepSize) - 1) * grid.stepSize;
            this.highestYLabel = (Math.ceil(this.highestDataPoint / grid.stepSize) + 1) * grid.stepSize;
        }

        this.top = this.highestYLabel;
        this.bottom = 0;
        this.range = this.top - this.bottom;

        //const labelAmount = Math.ceil(this.range / grid.stepSize) - 1;
        const labelAmount = Math.ceil(this.highestDataPoint / grid.stepSize) + 1;

        this.yLabels = Array(labelAmount)
            .fill()
            .map((e, i) => grid.stepSize * i);

        if (!yAxis.visible) {
            this.yAxisWidth = 0;
        } else if (yAxis.labelWidth) {
            this.yAxisWidth = yAxis.labelWidth;
        } else {
            const lengths = this.yLabels.map(v => yAxis.labelFormatter(v).length);
            const maxLength = Math.max(...lengths);
            this.yAxisWidth = maxLength * yAxis.labelFontSize * 0.66;
        }

        this.gridOffset = {
            x: insetX + this.yAxisWidth - 40,
            y: insetY
        };

        this.gridSize = {
            width: width - insetX * 2 - this.yAxisWidth,
            height: height - insetY * 2
        };

        this.highestLine = this.realY(this.yLabels[this.yLabels.length - 1]);
        this.lowestLine = this.realY(this.yLabels[0]);

        this.points = this.calculatePoints(interpolation);
        this.formattedPoints = this.formatPoints(this.points);
        this.areaPoints = this.formatPoints(this.calculateAreaPoints(interpolation));

        if (xAxis.visible) {
            this.xLabelPoints = data.map((y, x) => ({
                x: this.gridOffset.x + this.realX(x),
                y: this.gridSize.height
            }));
        }
    }

    scaleY(y) {
        const calc = 1 - (y - this.bottom) / this.range;
        return calc;
    }

    realX(x) {
        const calc = (x * this.gridSize.width) / (this.props.data.length - 1);
        return _.isNaN(calc) ? 0 : calc;
    }

    realY(y) {
        return this.scaleY(y) * this.gridSize.height;
    }

    scaleXYPoints() {
        return this.props.data.map((y, x) => ({
            x: this.realX(x),
            y: this.realY(y)
        }));
    }

    linearPoints() {
        const points = this.scaleXYPoints();
        return points;
    }

    splinePoints() {
        const tuples = this.scaleXYPoints();
        const xs = tuples.map(t => t.x);
        const ys = tuples.map(t => t.y);
        const lastXCoordinate = Math.max(...xs);
        const points = [];
        for (let x = 0; x <= lastXCoordinate; x += 1) {
            const y = spline(x, xs, ys);
            points.push({ x, y });
        }

        return points;
    }

    calculatePoints(interpolation) {
        if (interpolation === "spline") {
            return this.splinePoints();
        } else {
            return this.linearPoints();
        }
    }

    formatPoints(points) {
        return points.map(p => p.x + "," + p.y).join(" ");
    }

    calculateAreaPoints(interpolation) {
        const points = this.calculatePoints(interpolation);

        if (this.props.data.length > 1) {
            points.push({
                x: points[points.length - 1].x + 0.5, // pixel fix
                y: points[points.length - 1].y
            });
            points.push({ x: this.gridSize.width, y: this.lowestLine });
            points.push({ x: 0, y: this.lowestLine });
        }

        return points;
    }

    renderYAxisLabels = config => {
        const { yAxis, insetX } = config;
        const { dimensions: { width } } = this.state;

        if (yAxis.visible && this.yLabels) {
            
            return this.yLabels.slice(0, this.yLabels.length).map(yLabel => (
                <Text
                    key={yLabel}
                    fill={yAxis.labelColor}
                    fontSize={yAxis.labelFontSize}
                    x={width - 15}
                    y={this.realY(yLabel)}
                    textAnchor="end"
                    height={yAxis.labelFontSize}
                    fontWeight="400"
                    dy={yAxis.labelFontSize * 0.3}
                >
                    {yAxis.labelFormatter(yLabel)}
                </Text>
            ));
        }

        return undefined;
    }

    renderXAxisLabels = config => {
        const { xAxis } = config;
        const { xLabels } = this.props;

        if (xAxis.visible && xLabels) {
            return this.xLabelPoints.map((point, i) => (
                <Text
                    key={point.x}
                    fill={xAxis.labelColor}
                    fontSize={xAxis.labelFontSize}
                    x={point.x}
                    y={point.y + 5}
                    textAnchor="middle"
                    height={xAxis.labelFontSize}
                    dy={xAxis.labelFontSize}
                    fontWeight="400"
                >
                    {xLabels[i]}
                </Text>
            ));
        }

        return undefined;
    }

    renderGrid = config => {
        const { grid } = config;

        if (grid.visible) {
            return (
                <React.Fragment>
                    {this.yLabels.slice(0, this.yLabels.length).map(yLabel => {

                        return (
                            <Line
                                key={yLabel}
                                x1={this.gridOffset.x}
                                y1={this.realY(yLabel)}
                                x2={this.gridOffset.x + this.gridSize.width}
                                y2={this.realY(yLabel)}
                                stroke={grid.strokeColor}
                                strokeWidth={grid.strokeWidth}
                            />
                        )
                    }
                    )}
                </React.Fragment>
            );
        }

        return undefined;
    }

    renderDataArea = config => {
        const { area } = config;
        if (area.visible) {
            return (
                <React.Fragment>
                    <Defs>
                        <LinearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <Stop offset="0%" stopColor={area.gradientFrom} stopOpacity={area.gradientFromOpacity} />
                            <Stop offset="100%" stopColor={area.gradientTo} stopOpacity={area.gradientToOpacity} />
                        </LinearGradient>
                    </Defs>
                    <Polygon x={this.gridOffset.x} points={this.areaPoints} fill="url(#grad)" strokeWidth="0" />
                </React.Fragment>
            );
        }

        return undefined;
    }

    renderDataLine = config => {
        const { line } = config;
        if (line.visible) {
            return (
                <Polyline
                    fill="none"
                    strokeLinecap="round"
                    points={this.formattedPoints}
                    x={this.gridOffset.x}
                    stroke={line.strokeColor}
                    strokeWidth={line.strokeWidth}
                />
            );
        }

        return undefined;
    }

    renderDataPoints = config => {
        const { dataPoint } = config;
        const label = dataPoint.label;

        if (dataPoint.visible && this.points) {
            return this.points.map((point, index) => (
                <React.Fragment key={point.x}>
                    <Circle cx={point.x + this.gridOffset.x} cy={point.y} r={dataPoint.radius} fill={dataPoint.color} />
                    {label.visible && (
                        <Text
                            fill={dataPoint.label.labelColor}
                            fontSize={label.labelFontSize}
                            x={point.x}
                            textAlignVertical="center"
                            y={this.gridOffset.y + point.y - dataPoint.label.marginBottom}
                            dx={this.gridOffset.x}
                            textAnchor="middle"
                            height={label.labelFontSize}
                            dy={label.labelFontSize * 0.3}
                            fontWeight="400"
                        >
                            {label.labelFormatter(this.props.data[index])}
                        </Text>
                    )}
                </React.Fragment>
            ));
        }
        return undefined;
    }

    renderTooltip = config => {
        if (this.state.tooltipIndex === undefined ||
            this.points[this.state.tooltipIndex] === undefined) {
            return undefined;
        }

        const { tooltip } = config;

        const dataX = this.points[this.state.tooltipIndex].x;
        const dataY = this.points[this.state.tooltipIndex].y;

        const dataValue = this.props.data[this.state.tooltipIndex];
        const label = tooltip.labelFormatter(dataValue, this.state.tooltipIndex)

        const textWidth = label.length * tooltip.labelFontSize * 0.66 + tooltip.boxPaddingX;
        const textHeight = tooltip.labelFontSize * 1.5 + tooltip.boxPaddingY;

        return (
            <React.Fragment>
                <Line
                    x1={dataX + this.gridOffset.x}
                    x2={dataX + this.gridOffset.x}
                    y1={dataY}
                    y2={dataY - 20}
                    stroke={tooltip.lineColor}
                    strokeWidth={tooltip.lineWidth}
                />
                <Rect
                    x={this.gridOffset.x + dataX - textWidth / 2}
                    y={this.gridOffset.y + dataY - 20 - textHeight}
                    rx={tooltip.boxBorderRadius}
                    width={textWidth}
                    height={textHeight}
                    fill={tooltip.boxColor}
                    strokeWidth={tooltip.boxBorderWidth}
                    stroke={tooltip.boxBorderColor}
                />
                <Text
                    fill={tooltip.labelColor}
                    fontSize={tooltip.labelFontSize}
                    x={dataX}
                    textAlignVertical="center"
                    y={this.gridOffset.y + dataY - 20 - textHeight / 2}
                    dx={this.gridOffset.x}
                    textAnchor="middle"
                    height={tooltip.labelFontSize}
                    dy={tooltip.labelFontSize * 0.3}
                    fontWeight="400"
                >
                    {label}
                </Text>
            </React.Fragment>
        );
    }

    renderLineOrange = () => {
        const { dimensions: { width } } = this.state;

        const { data } = this.props;
        const avg = data.reduce((ac, vl, i, ar) => ac + (vl / ar.length), 0);

        const dataY = this.realY(avg);

        const label = `R$${String(avg.toFixed(2).replace('.', ','))}`;
        const size = label.length;

        const fontSize = 10;
        const textWidth = label.length * fontSize * 0.66;
        const textHeight = fontSize * 1.5;

        return (
            <G>
                <Line
                    x1={this.gridOffset.x}
                    x2={width - 15}
                    y1={dataY}
                    y2={dataY}
                    stroke={'#FA8602'}
                    strokeDasharray="0, 0"
                    strokeWidth={1.3}
                />
                <G x={width - 60}>
                    <Rect
                        x={this.gridOffset.x - textWidth / 2}
                        y={this.gridOffset.y + dataY - 7 - textHeight}
                        width={textWidth}
                        height={textHeight}
                        fill="#FA8602"
                    />
                    <Text
                        x={this.gridOffset.x - (size * .15)}
                        y={this.gridOffset.y + dataY - 4 - textHeight / 2}
                        fontSize={fontSize}
                        fill={"#ffffff"}
                        textAnchor={"middle"}>
                        {label}
                    </Text>
                </G>
            </G>
        );
    }

    onLayout = event => {
        const { width, height } = event.nativeEvent.layout;
        this.setState({ dimensions: { width, height } });
    }

    componentDidUpdate() {
        if (this.props.reset) {
            this.scrollRef.scrollTo({ y: 0, x: this.graphicWidth, animated: false });
        }
    }

    get graphicWidth() {
        const { width: widthfull } = Dimensions.get('window');
        const monthWidth = 100;
        const graphicWidth = this.props.data.length * monthWidth;
        return this.props.data.length > 3 ? graphicWidth : widthfull - 10;
    }

    mergeConfigs = memoizeOne((c1, c2) => deepmerge(c1, c2))

    render() {
        if (this.props.data.length === 0) {
            return (
                <View style={style.notFound}>
                    <RText style={style.text}>Sem dados para exibir</RText>
                </View>
            );
        }

        if (this.state.dimensions) {
            const { dimensions } = this.state;
            var { height } = dimensions;
        }

        const width = this.graphicWidth;

        // Don't worry, this is memoized
        this.recalculate(this.state.dimensions, this.props.data, this.props.config);

        const config = this.mergeConfigs(defaultConfig, this.props.config);
        const { grid, insetX, insetY, backgroundColor, backgroundOpacity } = config;

        // Ease of use
        const gridSize = this.gridSize;
        const gridOffset = this.gridOffset;

        return (
            <ScrollView
                horizontal
                ref={ref => { this.scrollRef = ref }}
                onLayout={() => {
                    this.scrollRef.scrollTo({ y: 0, x: width, animated: false });
                }}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}>

                <View
                    style={Object.assign({ alignSelf: "stretch" }, this.props.style, { backgroundColor, width })}
                    onLayout={this.onLayout}
                    {..._.get(this._panResponder, "panHandlers", {})}
                    ref={view => { this.myComponent = view }}
                >
                    {this.points ? (
                        <Svg width={width} height={height}>
                            {/* Draw background */}
                            <Rect x="0" y="0" width={width} height={height} fill={backgroundColor} fillOpacity={backgroundOpacity} />
                            {/* Draw Y axis label area | TODO: I think this is no longer needed */}
                            <Rect x={insetX} y={insetY} width={this.yAxisWidth} height={gridSize.height} fill={backgroundColor} fillOpacity={backgroundOpacity} />
                            {/* Draw background for actual chart area */}
                            <Rect
                                x={gridOffset.x}
                                y={gridOffset.y}
                                width={gridSize.width}
                                height={gridSize.height}
                                fill={grid.backgroundColor}
                                fillOpacity={backgroundOpacity}
                            />
                            {this.renderYAxisLabels(config)}
                            {this.renderXAxisLabels(config)}
                            {this.renderGrid(config)}
                            {this.renderDataArea(config)}
                            {this.renderDataLine(config)}
                            {this.renderLineOrange()}
                            {this.renderTooltip(config)}
                            {this.renderDataPoints(config)}
                        </Svg>
                    ) : (
                            undefined
                        )}
                </View>
            </ScrollView>
        );
    }
}

const defaultConfig = {
    grid: {
        visible: true,
        backgroundColor: "#fff",
        strokeWidth: 1,
        strokeColor: "#ededed",
        stepSize: 15
    },
    line: {
        visible: true,
        strokeWidth: 1,
        strokeColor: "#333"
    },
    area: {
        visible: true,
        gradientFrom: "#be2ddd",
        gradientFromOpacity: 1,
        gradientTo: "#e056fd",
        gradientToOpacity: 0.4
    },
    yAxis: {
        visible: true,
        labelFontSize: 12,
        labelColor: "#777",
        labelFormatter: v => 'R$' + String(v.toFixed(2)).replace('.', ','),
    },
    xAxis: {
        visible: false,
        labelFontSize: 12,
        labelColor: "#777"
    },
    tooltip: {
        visible: false,
        labelFormatter: v => 'R$' + String(v.toFixed(2)).replace('.', ','),
        lineColor: "#777",
        lineWidth: 1,
        circleColor: "#fff",
        circleBorderColor: "#fff",
        circleBorderWidth: 1,
        boxColor: "#fff",
        boxBorderWidth: 1,
        boxBorderColor: "#777",
        boxBorderRadius: 5,
        boxPaddingY: 0,
        boxPaddingX: 0,
        labelColor: "black",
        labelFontSize: 10
    },
    dataPoint: {
        visible: false,
        color: "#777",
        radius: 5,
        label: {
            visible: false,
            labelFontSize: 12,
            labelColor: "#777",
            labelFormatter: v => 'R$' + String(v.toFixed(2)).replace('.', ','),
            marginBottom: 25
        }
    },
    insetY: 0,
    insetX: 0,
    interpolation: "none",
    backgroundColor: "#fff",
    backgroundOpacity: 1
};

LineChart.defaultProps = {
    reset: false,
    onPress: () => { },
    data: [1.52, 1.42, 1.58, 1.39, 1.60, 1.45, 1.55],
    xLabels: ["Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr"],
    style: {},
    config: {
        line: {
            strokeColor: "#2396FF",
            strokeWidth: 2
        },
        area: {
            gradientFrom: "#2396FF",
            gradientFromOpacity: 0.3,
            gradientTo: "#2396FF",
            gradientToOpacity: 0.3
        },
        xAxis: {
            visible: true,
        },
        tooltip: {
            visible: true,
            lineColor: "#C9F3FF",
            circleColor: "#C9F3FF",
            circleBorderColor: "#C9F3FF",
            boxColor: "#C9F3FF",
            boxBorderColor: "#C9F3FF",
            boxBorderRadius: 0,
            labelColor: "#000000",
        },
        grid: {
            strokeColor: "#ededed",
            stepSize: 0.3
        },
        insetY: 15,
        insetX: 20
    }
};

const style = StyleSheet.create({
    notFound: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center'
    },
    text: {
        fontSize: 12,
        color: '#616A6B',
        textAlign: 'center'
    }
});

export default LineChart;
