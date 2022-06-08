const fs = require('fs');
const changeCase = require('change-case');
const path = require('path');

function loadYamlFile(filename) {
  const yaml = require('js-yaml');
  const yamlText = fs.readFileSync(filename, 'utf8')
  return yaml.safeLoad(yamlText);
}

function extractApiPath(fullPath) {
  let removeFirstSlash = fullPath.substring(fullPath.indexOf("\/") + 1);
  let removeTopPath = fullPath.substring(removeFirstSlash.indexOf("\/") + 1)
  return removeTopPath;
}

function extractDefinitionObject(def) {
  return changeCase.pascalCase(def.replace("#/definitions/", ""))
}

function extractResponseValue(responseSchema) {

  if (responseSchema) {
    let responseType = responseSchema.type;

    if (responseType) {

      if (responseType == "array") {
        // 例 { type: 'array', items: { '$ref': '#/definitions/rebate_statement' } }
        responseValue = `List<${extractDefinitionObject(responseSchema.items["$ref"])}>`

      } else if (responseType == "string") {
        // 例 { type: 'string', format: 'binary' }
        responseValue = "未対応の型"

      } else if (responseType == "object") {

        let key = Object.keys(responseSchema["properties"]).map(key => key);

        if (responseSchema["properties"][key]) {

          if (responseSchema["properties"][key].type && responseSchema["properties"][key].type == "array") {
            responseValue = `List<${extractDefinitionObject(responseSchema["properties"][key].items["$ref"])}>`

          } else if (responseSchema["properties"][key].type && responseSchema["properties"][key].type == "string") {
            responseValue = "String"
          }
        } else {
          // これは特例扱いにする、さすがに対応してられない
          // responseSchema {
          //  type: 'object',
          // properties: {
          //   hoge: { description: 'foo', allOf: [Array] },
          //   fuga: { description: 'bar', allOf: [Array] }
          // }
          responseValue = "未対応の型"
        }
      }

    } else if (responseSchema["$ref"]) {
      // 例 { '$ref': '#/definitions/resultModel' }
      responseValue = extractDefinitionObject(responseSchema["$ref"])
    } else {
      responseValue = "未対応の型"
    }
  }
  return responseValue;
}

function writeFiles(role, renderObject, resourceName) {
  // ファイル出力用のディレクトリを作成

  let rolePath = path.join(__dirname, "api", `/${role}`);
  if (!fs.existsSync(rolePath)) {
    fs.mkdir(rolePath, (err) => {
      if (err) { throw err; }
    });
  }

  // ファイル出力
  let targetPath = path.join(__dirname, "api", `/${role}`, `${changeCase.pascalCase(resourceName)}${changeCase.pascalCase(role)}.java`);
  if (!fs.existsSync(targetPath)) {
    fs.writeFile(targetPath, renderObject, (err, data) => {
      if (err) console.log(err);
      // else console.log(`${changeCase.pascalCase(resourceName)}${changeCase.pascalCase(role)}.java 出力`);
    });
  }
}

// Entry point
if (require.main === module) {
  const _ = require('lodash');
  const Mustache = require('mustache');

  const readline = require('readline/promises');

  (async () => {
    const readInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const fileName = await readInterface.question("ファイル名を入力してください(例：sample.yaml) >");
    readInterface.close();

    let outputPath = path.join(__dirname, "api");
    if (!fs.existsSync(outputPath)) {
      fs.mkdir(outputPath, (err) => {
        if (err) { throw err; }
      });
    }

    try {
      // yamlをロード
      const yaml = loadYamlFile(path.join(__dirname, `${fileName}`));

      Object.keys(yaml).filter(key => key == 'paths').forEach(key => {
        // yamlからpathの一覧のみ取得
        let paths = yaml[key];

        // リソースごとにグルーピング
        let pathsGroupByResource = Object.keys(paths).reduce((result, fullPath) => {

          // リソース部分を取得
          let key = fullPath.split("/")[1];
          if (!result[key]) {
            result[key] = [];
          }

          Object.keys(paths[fullPath]).forEach(item => {
            let httpMethod = item;
            paths[fullPath][httpMethod].path = fullPath;
            result[key].push({ [httpMethod]: paths[fullPath][httpMethod] })
          })
          return result;

        }, {});

        // リソースごとに処理
        Object.keys(pathsGroupByResource).forEach(resourceName => {

          // 1リソース毎のクラスを表現するオブジェクト
          let classObject = {
            resource: resourceName,
            pascalClassname: changeCase.pascalCase(resourceName),
            camelClassname: changeCase.camelCase(resourceName)
          };

          let apis = [];
          _.forEach(pathsGroupByResource[resourceName], item => {

            let httpMethod = Object.keys(item)[0];
            let api = item[httpMethod];

            let fullPath = item[httpMethod].path;

            // javadoc(メソッド)のパラメータを保持する配列
            let javadocParameters = [];
            // メソッドの引数に設定するパラメータの情報を保持する配列
            let parameters = [];
            _.forEach(api["parameters"], (parameter, index) => {
              javadocParameters.push({
                param: parameter.name,
                paramDescription: parameter.description
              });

              // in, typeに応じてパラメータを作成する
              let parameterVariable;
              if (api["parameters"].length == index + 1) {
                parameterVariable = changeCase.camelCase(parameter.name)
              } else {
                parameterVariable = changeCase.camelCase(parameter.name) + ", ";
              }

              // パラメータの種類に応じてアノテーション付与の有無等を決定
              let paramIn = parameter.in;
              let parameterType;
              if (paramIn == "path") {
                parameterType = `@PathParam(\"${parameter.name}\") ${changeCase.pascalCase(parameter.type)}`
              } else if (paramIn == "query") {
                parameterType = `@QueryParam(\"${parameter.name}\") ${changeCase.pascalCase(parameter.type)}`
              } else {
                parameterType = changeCase.pascalCase(parameter.name)
              }

              parameters.push({
                parameterType: parameterType,
                parameterVariable: parameterVariable
              })
            })

            // レスポンスに関する情報を設定
            let response = {
              returnDescription: api.responses["200"].description,
              responseValue: extractResponseValue(api.responses["200"].schema)
            }

            let apiObject = {
              description: api.description,
              summary: api.summary,
              produce: api.produces,
              httpMethod: changeCase.constantCase(httpMethod),
              methodName: item[httpMethod].operationId,
              path: extractApiPath(fullPath),
              existResponse: api.responses["200"].schema ? true : false,
              javadocParameters: javadocParameters,
              parameters: parameters,
              response: response
            }

            apis.push(apiObject);

          })

          classObject.apis = apis;

          // ファイル出力
          let roles = ["controller", "service", "business", "dao"];
          roles.forEach(role => {
            const contTemplateText = fs.readFileSync(path.join(__dirname, "template", `${role}Template.mustache`), 'utf8');
            let contRenderObject = Mustache.render(contTemplateText, { classObject });
            writeFiles(role, contRenderObject, resourceName);
          })
        })
      });

    } catch (err) {
      console.error(err.message);
    }

  })();
}

