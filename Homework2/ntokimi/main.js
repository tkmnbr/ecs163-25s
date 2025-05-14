console.log("🚀 main.js loaded");

// load data
Promise.all([
  d3.csv("data/ds_salaries.csv", d => {
    return {
      work_year:        +d.work_year,
      experience_level: d.experience_level,
      employment_type:  d.employment_type,
      company_size:     d.company_size,
      salary:           +d.salary_in_usd,
      country:          d.employee_residence,
      remote_ratio:     +d.remote_ratio
    };
  }),
  d3.json("data/countries.geojson")
]).then(([salaryData, worldTopo]) => {
  drawMap(salaryData, worldTopo);
  drawSankey(salaryData);
  drawHistogram(salaryData);
});

// map (overview)
function drawMap(data, geo) {
  const svg    = d3.select("#map");
  const width  = svg.node().clientWidth;
  const height = svg.node().clientHeight;

  // data processing
  const avgByCountry = d3.rollup(
    data, v => d3.mean(v, d => d.salary), d => d.country
  );
  const countries = geo.features;
  const projection = d3.geoMercator().fitSize([width, height], geo);
  const path       = d3.geoPath(projection);
  const color = d3.scaleSequential(d3.interpolateYlGnBu)
                  .domain(d3.extent(Array.from(avgByCountry.values())));

  // map background
  svg.selectAll("path")
    .data(countries)
    .join("path")
      .attr("d", path)
      .attr("fill", d => {
        const iso2 = d.properties["ISO3166-1-Alpha-2"];
        const avg  = avgByCountry.get(iso2);
        return avg != null ? color(avg) : "#eee";
      })
      .attr("stroke", "#999");

  
  // legend
  const legendWidth  = 200;
  const legendHeight = 10;
  const legendX      = 20;
  const legendY      = height - 30;

  // define gradient
  const defs = svg.append("defs");
  const lg   = defs.append("linearGradient")
                   .attr("id", "legend-gradient");
  lg.selectAll("stop")
    .data(d3.range(0, 1.01, 0.25))
    .join("stop")
      .attr("offset", d => `${d * 100}%`)
      .attr("stop-color", d => color(
        d3.interpolateNumber(...color.domain())(d)
      ));

  // legend background
  const legendG = svg.append("g")
    .attr("transform", `translate(${legendX},${legendY})`);
  legendG.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("fill", "url(#legend-gradient)")
    .style("stroke", "#999");

  // legend ticks
  const legendScale = d3.scaleLinear()
    .domain(color.domain())
    .range([0, legendWidth]);
  legendG.append("g")
    .attr("transform", `translate(0,${legendHeight})`)
    .call(d3.axisBottom(legendScale)
      .ticks(5)
      .tickFormat(d3.format("$.2s"))
    );
}


// sankey (focus)
function buildSankeyData(data) {
  // rollup each data
  const counts = d3.rollups(
    data,
    v => v.length,
    d => d.employment_type,
    d => d.experience_level,
    d => d.company_size
  );

  const links = [];
  const nodesSet = new Set();
  counts.forEach(([empType, levelArr]) => {
    levelArr.forEach(([expLevel, sizeArr]) => {
      // employment_type → experience_level
      nodesSet.add(empType);
      nodesSet.add(expLevel);
      const valEL = d3.sum(sizeArr, d => d[1]);
      links.push({ source: empType, target: expLevel, value: valEL });
      // experience_level → company_size
      sizeArr.forEach(([compSize, cnt]) => {
        nodesSet.add(compSize);
        links.push({ source: expLevel, target: compSize, value: cnt });
      });
    });
  });
  // create nodes array
  const nodes = Array.from(nodesSet).map(id => ({ id }));
  return { nodes, links };
}

function drawSankey(data) {
  const svg = d3.select("#sankey");
  const W   = svg.node().clientWidth;
  const H   = svg.node().clientHeight;

  const margin = { top: 25, right: 10, bottom: 20, left: 10 };
  const width  = W - margin.left - margin.right;
  const height = H - margin.top - margin.bottom;

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const sankeyData = buildSankeyData(data);

  const { nodes, links } = d3.sankey()
    .nodeId(d => d.id)
    .nodeWidth(15)    
    .nodePadding(10)    
    .extent([[0, 0], [width, height]])
    ({
      nodes: sankeyData.nodes.map(d => ({ ...d })),
      links: sankeyData.links.map(d => ({ ...d }))
    });

  const color = d3.scaleOrdinal(d3.schemeTableau10)
    .domain(nodes.map(d => d.id));

  g.append("g")
    .selectAll("path")
    .data(links)
    .join("path")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke-width", d => Math.max(1, d.width))
      .attr("stroke", d => color(d.source.id))
      .attr("fill", "none")
      .attr("opacity", 0.5);

  const nodeG = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
      .attr("transform", d => `translate(${d.x0},${d.y0})`);

  nodeG.append("rect")
    .attr("height", d => d.y1 - d.y0)
    .attr("width", d => d.x1 - d.x0)
    .attr("fill", d => color(d.id))
    .attr("stroke", "#333");

  nodeG.append("text")
    .attr("x", d => d.x0 < width / 2 ? (d.x1 - d.x0) + 4 : -4)
    .attr("y", d => (d.y1 - d.y0) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
    .style("font-size", "10px")
    .text(d => d.id);

  svg.append("text")
    .attr("x", W / 2)
    .attr("y", margin.top / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "bold")
    .text("Flow: Employment → Experience → Company Size");
}



// histgram (context)
function drawHistogram(data) {
  const svg    = d3.select("#histogram");
  const W      = svg.node().clientWidth;
  const H      = svg.node().clientHeight;

  // margin and size
  const margin = { top: 30, right: 20, bottom: 40, left: 50 };
  const width  = W - margin.left - margin.right;
  const height = H - margin.top - margin.bottom;

  // svg
  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // data processing
  const salaries = data.map(d => d.salary);
  const x = d3.scaleLinear()
    .domain(d3.extent(salaries))
    .nice()
    .range([0, width]);
  const bins = d3.bin()
    .domain(x.domain())
    .thresholds(30)(salaries);
  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, d => d.length)])
    .nice()
    .range([height, 0]);

  // draw histogram
  g.selectAll("rect")
    .data(bins)
    .join("rect")
      .attr("x", d => x(d.x0) + 1)
      .attr("y", d => y(d.length))
      .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .attr("height", d => height - y(d.length))
      .attr("fill", "steelblue");

  // draw axes
  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("$.2s")));
  g.append("g")
    .call(d3.axisLeft(y));

  // title and labels
  // title
  svg.append("text")
    .attr("x", W/2)
    .attr("y", margin.top/2)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Salary Distribution");
  // x axis label
  svg.append("text")
    .attr("x", margin.left + width/2)
    .attr("y", H - 6)
    .attr("text-anchor", "middle")
    .text("Salary (USD)");
  // y axis label
  svg.append("text")
    .attr("x", - (margin.top + height/2))
    .attr("y", 12)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .text("Count");
}
